/**
 * TỰ ĐỘNG HÓA BIÊN TẬP BÁO CHÍ VÀ ĐĂNG BÀI CMS
 * Sử dụng: ES Modules (import/export), Gemini SDK (@google/genai), Puppeteer
 */

import fs from 'fs/promises';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import puppeteer from 'puppeteer';
import { createRequire } from 'module';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// Nhận username từ đối số dòng lệnh
const username = process.argv[2];
if (!username) {
  console.error("Lỗi: Thiếu tham số tên người dùng!");
  process.exit(1);
}

// Thư mục chứa các văn bản thô đầu vào
const INPUT_DIR = path.resolve(`../Vanban_CMS/${username}`);
// File lưu thông tin cấu hình và tài khoản đăng nhập
const KEY_FILE = path.resolve(`./data/users/${username}/config.json`);
// File JSON lưu kết quả đầu ra
const OUTPUT_JSON = path.resolve(`./data/users/${username}/data_CMS.json`);
// Thư mục lưu trữ các văn bản đã xử lý
const ARCHIVE_DIR = path.resolve(`../Luu_CMS/${username}`);

/**
 * Định dạng ngày hiện tại thành chuỗi YYYY-MM-DD HH:mm:ss
 * @returns {string}
 */
function formatCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Tác vụ 1: Đọc tất cả các tệp văn bản (.txt) hoặc tài liệu (.pdf) trong thư mục đầu vào
 * @param {string} dirPath - Đường dẫn thư mục cần quét
 * @returns {Promise<Array<{fileName: string, rawContent: string}>>}
 */
async function readTextFiles(dirPath) {
  console.log(`[Tác vụ 1] Bắt đầu quét thư mục: ${dirPath}...`);
  try {
    // Kiểm tra thư mục có tồn tại không
    await fs.access(dirPath);
    
    const files = await fs.readdir(dirPath);
    const inputFiles = files.filter(file => {
      const ext = file.toLowerCase();
      return ext.endsWith('.txt') || ext.endsWith('.pdf');
    });
    
    if (inputFiles.length === 0) {
      console.warn(`[Cảnh báo] Không tìm thấy file .txt hoặc .pdf nào trong thư mục ${dirPath}`);
      return [];
    }

    const results = [];
    for (const file of inputFiles) {
      const filePath = path.join(dirPath, file);
      let content = '';

      if (file.toLowerCase().endsWith('.txt')) {
        content = await fs.readFile(filePath, 'utf-8');
      } else if (file.toLowerCase().endsWith('.pdf')) {
        const dataBuffer = await fs.readFile(filePath);
        const parser = new pdf.PDFParse({
          data: new Uint8Array(dataBuffer),
          verbosity: pdf.VerbosityLevel.ERRORS
        });
        try {
          const parsed = await parser.getText();
          content = typeof parsed === 'string' ? parsed : (parsed.text || '');
        } finally {
          await parser.destroy().catch(() => {});
        }
      }

      results.push({
        fileName: file,
        rawContent: content.trim()
      });
      console.log(` - Đã đọc và trích xuất thành công tệp: ${file}`);
    }
    return results;
  } catch (error) {
    console.error(`[Lỗi] Có lỗi xảy ra trong Tác vụ 1 khi đọc thư mục:`, error);
    throw error;
  }
}

/**
 * Tác vụ 2: Biên tập bài báo sử dụng Gemini SDK
 * @param {string} rawContent - Nội dung thô của văn bản
 * @returns {Promise<{title: string, content: string}>}
 */
async function editArticleWithGemini(rawContent, apiKey) {
  if (!apiKey) {
    throw new Error('Chưa tìm thấy khóa API để khởi chạy Gemini SDK.');
  }
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Bạn là một biên tập viên báo chí chuyên nghiệp. Hãy biên tập văn bản thô sau đây thành một bài báo hoàn chỉnh, mạch lạc và súc tích.

Nội dung văn bản thô:
${rawContent}

Ràng buộc bài viết bắt buộc tuân thủ nghiêm ngặt (TUÂN THỦ TUYỆT ĐỐI):
1. VĂN PHONG CHÍNH LUẬN, NGHIÊM TÚC: Sử dụng ngôn ngữ báo chí chính thống, nghiêm túc, khách quan và khoa học.
2. KHÔNG LẤY THÔNG TIN BÊN NGOÀI: Chỉ viết bài dựa trên chính xác các thông tin và dữ liệu thực tế được cung cấp trong văn bản gốc. Tuyệt đối không tự ý lấy thêm số liệu, thông tin hoặc bối cảnh từ bên ngoài văn bản thô.
3. TUYỆT ĐỐI KHÔNG BÌNH LUẬN HOẶC VIẾT THÊM: Không được đưa vào các câu bình luận, giải thích thêm mang tính chủ quan hoặc tự ý đánh giá ý nghĩa/tác động của sự kiện, tính pháp lý của quyết định nếu văn bản gốc không đề cập. (Ví dụ nghiêm cấm các câu viết thêm dạng: "Quyết định được xây dựng trên một nền tảng pháp lý vững chắc...", "Điều này tạo kênh thông tin minh bạch và cơ chế điều chỉnh linh hoạt khi cần thiết", "Đây là bước tiến quan trọng...", "Nhằm mục đích tối ưu hóa...").
4. ĐỊNH DẠNG VĂN BẢN (XUỐNG DÒNG ĐÚNG): Phải phân tách các đoạn văn rõ ràng bằng dấu xuống dòng kép \\n\\n giữa các đoạn. Không viết liền một mạch hoặc gộp các đoạn. Độ dài bài báo từ 500 đến 1000 từ.
5. Tuyệt đối KHÔNG chứa các câu hội thoại hoặc bình luận cá nhân của người biên tập (ví dụ không có: "Dưới đây là...", "Bài viết đã biên tập xong...").
6. Tuyệt đối KHÔNG dùng thể bị động (chỉ sử dụng thể chủ động).
7. TUÂN THỦ NGHIÊM NGẶT QUY TẮC VIẾT HOA TIẾNG VIỆT CHO TIÊU ĐỀ: Chỉ viết hoa chữ cái đầu tiên ở đầu tiêu đề và các danh từ riêng (địa danh "Quảng Ngãi", tên người, tên cơ quan...). Tất cả các từ thông thường khác (ví dụ: động từ, tính từ như "sắp xếp", "tổ chức", "tối ưu hóa", "hơn", "để" và danh từ chung như "thôn", "tổ dân phố", "bộ máy", "cơ sở"...) PHẢI VIẾT THƯỜNG.
   - Ví dụ SAI: "Quảng Ngãi Sắp Xếp Hơn 1.000 Thôn, Tổ Dân Phố Để Tối Ưu Hóa Bộ Máy Cơ Sở"
   - Ví dụ ĐÚNG: "Quảng Ngãi sắp xếp hơn 1.000 thôn, tổ dân phố để tối ưu hóa bộ máy cơ sở"
8. Trích xuất hoặc đặt tiêu đề cho bài viết thật khách quan, phản ánh chính xác nội dung chính của tin tức và tuân thủ quy tắc viết hoa ở trên.
9. Trích xuất một đoạn tóm tắt ngắn gọn, mạch lạc và súc tích (khoảng từ 1 đến 3 câu) phản ánh đúng nội dung chính của bài viết và gán vào trường "brief".
10. KHÔNG ĐỂ CÂU BAN HÀNH Ở CUỐI BÀI: Tuyệt đối không viết câu dạng "Thay mặt UBND tỉnh, Phó Chủ tịch Nguyễn Công Hoàng ký ban hành kế hoạch này" (hoặc các câu tương tự có nội dung ký ban hành quyết định/kế hoạch/văn bản) ở cuối phần nội dung bài viết. Nếu có thông tin ký ban hành, phải đưa thông tin đó lên đoạn tóm tắt ("brief"). Ví dụ phần tóm tắt: "Phó Chủ tịch UBND tỉnh Nguyễn Công Hoàng ký ban hành kế hoạch về..."`;

  const model = 'gemini-3.5-flash';
  const config = {
    // Ép kiểu đầu ra là JSON có cấu trúc
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Tiêu đề bài báo ngắn gọn, đúng phong cách truyền tải tin tức báo chí. BẮT BUỘC chỉ viết hoa chữ cái đầu tiên và danh từ riêng (địa danh Quảng Ngãi, tên người...). KHÔNG viết hoa chữ cái đầu của các từ thông thường khác.'
        },
        brief: {
          type: 'STRING',
          description: 'Tóm tắt ngắn gọn nội dung bài viết từ 1 đến 3 câu. Nếu bài viết có thông tin ký ban hành (ví dụ: Phó Chủ tịch UBND tỉnh Nguyễn Công Hoàng ký ban hành kế hoạch...), phải đưa thông tin này lên phần tóm tắt.'
        },
        content: {
          type: 'STRING',
          description: 'Nội dung chi tiết bài báo được biên tập từ 500 đến 1000 từ, bám sát văn bản gốc, phân tách các đoạn rõ ràng bằng \\n\\n, ngôn ngữ rõ ràng, tuyệt đối không tự ý suy diễn hay thêm chi tiết bên ngoài. Lưu ý tuyệt đối không viết câu thông tin ký ban hành kế hoạch ở cuối bài.'
        }
      },
      required: ['title', 'brief', 'content']
    }
  };

  const maxRetries = 5;
  let delay = 25000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(` - Đang kết nối tới Gemini API (${model}) để biên tập bài viết (Lần thử ${attempt}/${maxRetries})...`);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config
      });

      let jsonText = response.text.trim();
      
      // Đề phòng trường hợp API trả về markdown JSON block
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.substring(7);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.substring(0, jsonText.length - 3);
      }
      jsonText = jsonText.trim();

      const parsedData = JSON.parse(jsonText);
      return {
        title: parsedData.title,
        brief: parsedData.brief,
        content: parsedData.content
      };
    } catch (error) {
      // Xác định xem lỗi có phải do quá tải hoặc giới hạn lượt yêu cầu tạm thời không
      const isRetryable = error.status === 503 || error.status === 429 || 
                          error.message.includes('503') || error.message.includes('429') ||
                          error.message.includes('overloaded') || error.message.includes('demand') ||
                          error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('UNAVAILABLE');

      if (isRetryable && attempt < maxRetries) {
        console.warn(` [Cảnh báo] Lỗi API Gemini (${error.status || 'Tải cao'}). Thử lại lần sau sau ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Tăng gấp đôi thời gian chờ cho lần sau
      } else {
        console.error(`[Lỗi] Có lỗi xảy ra trong Tác vụ 2 khi kết nối Gemini API (sau ${attempt} lần thử):`, error);
        throw error;
      }
    }
  }
}

/**
 * Tác vụ 3: Đóng gói và lưu dữ liệu cấu trúc JSON
 * @param {Array<Object>} articles - Danh sách bài báo đã biên tập
 * @param {string} outputFilePath - Đường dẫn lưu file JSON
 */
async function saveToJSON(articles, outputFilePath, author = 'AI Editor') {
  console.log(`[Tác vụ 3] Bắt đầu đóng gói dữ liệu vào: ${outputFilePath}...`);
  try {
    const formattedData = articles.map(article => ({
      'Tiêu đề': article.title,
      'Tóm tắt': article.brief,
      'Nội dung': article.content,
      'Tác giả': author,
      'Tên File': article.fileName,
      'Ngày đăng': formatCurrentDate()
    }));

    await fs.writeFile(outputFilePath, JSON.stringify(formattedData, null, 2), 'utf-8');
    console.log(` - Đã lưu thành công ${formattedData.length} bài viết vào ${outputFilePath}`);
  } catch (error) {
    console.error(`[Lỗi] Có lỗi xảy ra trong Tác vụ 3 khi ghi file JSON:`, error);
    throw error;
  }
}

/**
 * Đọc thông tin cấu hình đăng nhập từ config.json
 * @param {string} filePath - Đường dẫn file config.json
 * @returns {Promise<Object>}
 */
async function loadCredentials(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const credentials = JSON.parse(data);

    if (!credentials.URL_LOGIN || !credentials.USERNAME || !credentials.PASSWORD) {
      throw new Error('Cấu hình người dùng phải có đầy đủ URL_LOGIN, USERNAME và PASSWORD.');
    }

    return credentials;
  } catch (error) {
    console.error(`[Lỗi] Không thể đọc hoặc phân tích cấu hình ${filePath}:`, error);
    throw error;
  }
}

/**
 * Tác vụ 4: Đăng bài tự động lên CMS thông qua Puppeteer
 * @param {string} jsonFilePath - File JSON nguồn dữ liệu
 * @param {Object} credentials - Cấu hình đăng nhập
 */
async function publishToCMS(jsonFilePath, credentials) {
  console.log(`[Tác vụ 4] Bắt đầu khởi chạy Puppeteer để đăng bài lên CMS...`);
  
  let rawArticles = [];
  try {
    const jsonContent = await fs.readFile(jsonFilePath, 'utf-8');
    rawArticles = JSON.parse(jsonContent);
  } catch (error) {
    console.error(`[Lỗi] Không thể đọc file JSON dữ liệu để đăng bài:`, error);
    return;
  }

  if (rawArticles.length === 0) {
    console.log('Không có bài viết nào để đăng.');
    return;
  }

  // Khởi tạo Puppeteer ở chế độ hiển thị (headless: false) để dễ quan sát
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null, // Sử dụng toàn bộ kích thước màn hình
    args: ['--start-maximized'] // Mở trình duyệt ở chế độ tối đa hóa cửa sổ
  });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(90000);

    // Tự động xử lý và chấp nhận hộp thoại (dialog/alert/confirm/beforeunload) để tránh kẹt tiến trình
    page.on('dialog', async dialog => {
      console.log(` [Hộp thoại] Phát hiện cảnh báo/thông báo: "${dialog.message()}". Tự động chấp nhận...`);
      await dialog.accept().catch(() => {});
    });

    // 1. Điều hướng đến trang URL đăng nhập
    console.log(` - Đang kết nối tới trang đăng nhập: ${credentials.URL_LOGIN}...`);
    try {
      await page.goto(credentials.URL_LOGIN, { waitUntil: 'load', timeout: 60000 });
    } catch (err) {
      console.log(` [Cảnh báo] Lỗi kết nối tới trang đăng nhập: ${err.message}. Tiếp tục...`);
    }

    // 2. Điền username, password và click Đăng nhập
    console.log(' - Đang tự động nhập thông tin tài khoản...');
    
    // Đợi các ô nhập liệu của form đăng nhập xuất hiện
    await page.waitForSelector('input[name="fields[username]"]', { timeout: 15000 });
    await page.type('input[name="fields[username]"]', credentials.USERNAME, { delay: 50 });
    
    await page.waitForSelector('input[name="fields[password]"]', { timeout: 15000 });
    await page.type('input[name="fields[password]"]', credentials.PASSWORD, { delay: 50 });

    console.log(' - Đang click nút Đăng nhập...');
    await page.click('input.btn-login');

    // Chờ quá trình đăng nhập và chuyển hướng hoàn tất
    console.log(' - Đang chờ đăng nhập thành công...');
    await page.waitForNavigation({ waitUntil: 'load', timeout: 25000 }).catch(() => {
      console.log(' * Chờ chuyển hướng trang lâu hơn bình thường, tiếp tục...');
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Vòng lặp đăng từng bài viết từ file JSON
    for (let i = 0; i < rawArticles.length; i++) {
      const article = rawArticles[i];
      console.log(`\n[Đăng bài ${i + 1}/${rawArticles.length}] Đang xử lý bài: "${article['Tiêu đề']}"`);

      // Chuyển hướng sang trang tạo bài viết mới bằng cơ chế thử lại (Retry)
      const createUrl = credentials.URL_CREATE || credentials.URL_LOGIN;
      const titleSelector = 'input[name="fields[title]"], input[name="title"], input#title, input[placeholder*="tiêu đề"], input[placeholder*="Tiêu đề"]';
      let onCreationPage = false;
      const maxTransitionRetries = 3;

      for (let attempt = 1; attempt <= maxTransitionRetries; attempt++) {
        try {
          // 1. Kiểm tra xem đã ở trên trang tạo bài viết hay chưa
          onCreationPage = await page.evaluate((sel) => {
            const bodyText = document.body.innerText;
            const hasActualTitleLabel = bodyText.includes('Tiêu đề*') || bodyText.includes('Nội dung*');
            const hasTitleInput = !!document.querySelector(sel);
            return hasActualTitleLabel && hasTitleInput;
          }, titleSelector);

          if (onCreationPage) {
            console.log(' - Đã ở trên trang nhập tin tức.');
            break;
          }

          // 2. Tự động phát hiện nếu đang ở trang đăng nhập (bị logout/chưa đăng nhập thành công)
          const isLoginPage = await page.evaluate(() => {
            return !!document.querySelector('input[name="fields[username]"]');
          });

          if (isLoginPage) {
            console.log(' - Phát hiện đang ở trang đăng nhập. Tiến hành đăng nhập lại...');
            await page.type('input[name="fields[username]"]', credentials.USERNAME, { delay: 50 });
            await page.type('input[name="fields[password]"]', credentials.PASSWORD, { delay: 50 });
            await page.click('input.btn-login');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue; // Thử lại bước này sau khi đăng nhập xong
          }

          // 3. Tự động phát hiện nếu chúng ta đang ở trang danh sách thay vì trang viết bài
          let isListPage = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));
            const hasAddBtn = buttons.some(btn => {
              const text = (btn.textContent || btn.value || '').toLowerCase().trim();
              return text === 'thêm mới' || text === 'thêm' || text === 'tạo mới' || text === 'tạo bài viết' || 
                     text.includes('thêm mới') || text.includes('tạo mới') || text.includes('add new');
            });
            const hasEditor = document.querySelector('iframe.cke_wysiwyg_frame') || (window.CKEDITOR && Object.keys(window.CKEDITOR.instances).length > 0) || document.body.innerText.includes('Tiêu đề*');
            return hasAddBtn && !hasEditor;
          });

          if (!isListPage) {
            console.log(` - Không ở trên trang tạo bài viết hoặc danh sách. Điều hướng đến: ${createUrl} (Lần thử ${attempt}/${maxTransitionRetries})...`);
            await page.goto(createUrl, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 4000));

            // Kiểm tra lại sau khi điều hướng
            isListPage = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));
              const hasAddBtn = buttons.some(btn => {
                const text = (btn.textContent || btn.value || '').toLowerCase().trim();
                return text === 'thêm mới' || text === 'thêm' || text === 'tạo mới' || text === 'tạo bài viết' || 
                       text.includes('thêm mới') || text.includes('tạo mới') || text.includes('add new');
              });
              const hasEditor = document.querySelector('iframe.cke_wysiwyg_frame') || (window.CKEDITOR && Object.keys(window.CKEDITOR.instances).length > 0) || document.body.innerText.includes('Tiêu đề*');
              return hasAddBtn && !hasEditor;
            });
          }

          if (isListPage) {
            console.log(' - Phát hiện đang ở trang danh sách. Đang tìm nút "Thêm mới"...');
            
            let addNewBtnHandle = null;
            // 1. Thử tìm các phần tử nút hành động (btn-action-primary, btn-primary,...) chứa chữ "Thêm" hoặc "Tạo"
            const actionButtons = await page.$$('a.btn-action-primary, button.btn-action-primary, a.btn-primary, button.btn-primary, .btn-action-primary, .btn-primary, .btn-success');
            for (const btn of actionButtons) {
              const text = await page.evaluate(el => (el.textContent || el.value || '').toLowerCase().trim(), btn);
              if (text.includes('thêm') || text.includes('tạo') || text.includes('add') || text.includes('create')) {
                addNewBtnHandle = btn;
                break;
              }
            }
            
            // 2. Fallback: tìm bất kỳ thẻ a hoặc button nào chứa chữ "thêm mới" hoặc "thêm"
            if (!addNewBtnHandle) {
              const allButtons = await page.$$('a, button, input[type="button"]');
              for (const btn of allButtons) {
                const text = await page.evaluate(el => (el.textContent || el.value || '').toLowerCase().trim(), btn);
                if (text === 'thêm mới' || text === 'thêm' || text === 'tạo mới' || text === 'tạo bài viết' ||
                    text.includes('thêm mới') || text.includes('tạo mới') || text.includes('add new')) {
                  addNewBtnHandle = btn;
                  break;
                }
              }
            }

            if (addNewBtnHandle) {
              console.log(' - Click nút "Thêm mới"...');
              await addNewBtnHandle.click();
              
              // Đợi dropdown mở ra
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              console.log(' - Đang tìm và click mục "Tin tức" trong menu dropdown...');
              const clickedSub = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a, span, li'));
                // Tìm phần tử chứa chữ "Tin tức" nằm trong dropdown đang mở hoặc hiển thị
                const targetEl = elements.find(el => {
                  const text = el.innerText.trim();
                  const isDropdownItem = el.closest('.dropdown-menu') || el.closest('ul') && el.closest('.open');
                  return text === 'Tin tức' && isDropdownItem;
                });
                if (targetEl) {
                  targetEl.click();
                  return true;
                }
                // Fallback: Tìm thẻ a chứa "Tin tức" đang hiển thị
                const anyLink = elements.find(el => {
                  const text = el.innerText.trim();
                  return text === 'Tin tức' && el.tagName === 'A' && el.offsetHeight > 0;
                });
                if (anyLink) {
                  anyLink.click();
                  return true;
                }
                return false;
              });

              if (clickedSub) {
                console.log(' - Đã click chọn "Tin tức". Đang chờ màn hình viết bài xuất hiện...');
                
                // Chờ cho đến khi trang "Thêm tin tức" xuất hiện
                onCreationPage = await page.waitForFunction((sel) => {
                  const bodyText = document.body.innerText;
                  const hasActualTitleLabel = bodyText.includes('Tiêu đề*') || bodyText.includes('Nội dung*');
                  const hasTitleInput = !!document.querySelector(sel);
                  return hasActualTitleLabel && hasTitleInput;
                }, { timeout: 25000 }, titleSelector).then(() => true).catch(() => false);

                if (onCreationPage) {
                  // Chờ thêm 3 giây để trang tải hoàn tất các rich editor JS (như CKEditor)
                  await new Promise(resolve => setTimeout(resolve, 3000));
                  break;
                }
              } else {
                console.warn(' - Không tìm thấy tùy chọn "Tin tức" để click.');
              }
            } else {
              console.warn(' - Không tìm thấy nút "Thêm mới" trên trang danh sách.');
            }
          } else {
            // Không phải list page, nhưng có thể chưa tải xong hoặc đang ở trạng thái khác. Kiểm tra xem có thể tự nhận diện được form không
            onCreationPage = await page.evaluate((sel) => {
              const bodyText = document.body.innerText;
              const hasActualTitleLabel = bodyText.includes('Tiêu đề*') || bodyText.includes('Nội dung*');
              const hasTitleInput = !!document.querySelector(sel);
              return hasActualTitleLabel && hasTitleInput;
            }, titleSelector);
            if (onCreationPage) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              break;
            }
          }
        } catch (innerError) {
          console.warn(` [Cảnh báo] Lỗi trong quá trình chuyển hướng ở lần thử ${attempt}: ${innerError.message}`);
          // Chờ 3 giây trước khi thử lại để trang ổn định
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // Đợi selector tiêu đề xuất hiện cuối cùng để bắt đầu nhập
      await page.waitForSelector(titleSelector, { timeout: 15000 });

      // Nhập Tiêu đề bài viết
      console.log(' - Đang nhập tiêu đề bài viết...');
      // Chọn input phù hợp nhất, ưu tiên nhãn "Tiêu đề" hoặc "Tiêu đề*" và loại trừ các ô tìm kiếm
      // Chọn input phù hợp nhất, ưu tiên nhãn "Tiêu đề" hoặc "Tiêu đề*" và loại trừ các ô tìm kiếm
      const titleInputSelected = await page.evaluate((selectorString) => {
        // Tìm tất cả phần tử trên trang chứa chữ "Tiêu đề"
        const labels = Array.from(document.querySelectorAll('label, div, span')).filter(el => {
          const text = el.innerText.trim();
          return text.startsWith('Tiêu đề') || text === 'Tiêu đề*';
        });
        
        for (const label of labels) {
          // Thử tìm input con của label
          let input = label.querySelector('input');
          if (!input) {
            // Thử tìm input ở các thẻ cha lân cận
            let parent = label.parentElement;
            if (parent) {
              input = parent.querySelector('input');
            }
          }
          if (input && input.type === 'text') {
            input.setAttribute('data-puppeteer-title', 'true');
            return true;
          }
        }

        // Fallback: Lọc bỏ các ô tìm kiếm ở danh sách nếu có
        const inputs = Array.from(document.querySelectorAll(selectorString));
        const filtered = inputs.filter(inp => {
          const parentForm = inp.closest('form');
          if (parentForm) {
            const formClass = (parentForm.className || '').toLowerCase();
            const formId = (parentForm.id || '').toLowerCase();
            if (formClass.includes('search') || formClass.includes('filter') || 
                formId.includes('search') || formId.includes('filter')) {
              return false;
            }
          }
          const placeholder = (inp.placeholder || '').toLowerCase();
          const name = (inp.name || '').toLowerCase();
          if (placeholder.includes('tìm') || placeholder.includes('search') || placeholder.includes('lọc') ||
              name.includes('search') || name.includes('filter')) {
            return false;
          }
          return true;
        });

        if (filtered.length > 0) {
          filtered[0].setAttribute('data-puppeteer-title', 'true');
          return true;
        }
        return false;
      }, titleSelector);

      const targetTitleSelector = titleInputSelected ? 'input[data-puppeteer-title="true"]' : titleSelector;
      await page.focus(targetTitleSelector);
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.type(targetTitleSelector, article['Tiêu đề'], { delay: 30 });

      // ==========================================
      // BƯỚC 2: Nhập danh mục mục tin "Tin tức" hoặc "Tin hoạt động Văn phòng"
      // ==========================================
      const targetCategory = credentials.Danhmuc || credentials.CATEGORY || 'Tin tức';
      console.log(` - Đang chọn danh mục: "${targetCategory}"...`);
      const categorySelected = await page.evaluate((categoryName) => {
        const hiddenInput = document.querySelector('input[name="fields[categories]"]');
        if (hiddenInput) {
          const selectId = `multiSelect-${hiddenInput.id}`;
          const selectEl = document.getElementById(selectId);
          if (selectEl) {
            const option = Array.from(selectEl.options).find(opt => {
              const text = opt.text.trim();
              return text === categoryName || 
                     text.toLowerCase().includes(categoryName.toLowerCase()) ||
                     (categoryName.toLowerCase().includes('hoạt động') && text.toLowerCase().includes('hoạt động'));
            });
            if (option) {
              const val = option.value;
              option.selected = true;
              selectEl.value = val;
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              
              if (window.jQuery) {
                window.jQuery(selectEl).val([val]).trigger('change');
              } else {
                hiddenInput.value = val;
              }
              return option.text;
            }
          }
        }
        return null;
      }, targetCategory);

      if (categorySelected) {
        console.log(` -> Đã chọn danh mục: "${categorySelected}".`);
      } else {
        console.warn(' -> Không chọn được danh mục.');
      }

      // ==========================================
      // BƯỚC 3: Nhập Tóm tắt bài viết
      // ==========================================
      console.log(' - Đang nhập tóm tắt bài viết...');
      const briefFilled = await page.evaluate((briefText) => {
        if (window.CKEDITOR && window.CKEDITOR.instances) {
          const targetInstance = Object.values(window.CKEDITOR.instances).find(inst => {
            return inst.name && (inst.name.includes('brief') || 
                   (inst.element && inst.element.$ && inst.element.$.name === 'fields[brief]'));
          });
          if (targetInstance) {
            targetInstance.setData(briefText);
            return 'ckeditor-js-by-name';
          }
          const instances = Object.keys(window.CKEDITOR.instances);
          if (instances.length > 1) {
            window.CKEDITOR.instances[instances[0]].setData(briefText);
            return 'ckeditor-js-index-0';
          }
        }
        const labels = Array.from(document.querySelectorAll('label, div, span')).filter(el => {
          return el.innerText.trim().startsWith('Tóm tắt');
        });
        for (const label of labels) {
          let container = label.parentElement;
          if (container) {
            const editableDiv = container.querySelector('div[contenteditable="true"]');
            if (editableDiv) {
              editableDiv.innerHTML = briefText;
              return 'contenteditable-div';
            }
            const textarea = container.querySelector('textarea');
            if (textarea) {
              textarea.value = briefText;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              textarea.dispatchEvent(new Event('change', { bubbles: true }));
              return 'textarea';
            }
          }
        }
        const briefTextarea = document.querySelector('textarea[name="fields[brief]"]');
        if (briefTextarea) {
          briefTextarea.value = briefText;
          briefTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          return 'textarea-by-name';
        }
        return null;
      }, article['Tóm tắt']);

      if (briefFilled) {
        console.log(` -> Đã điền tóm tắt thành công (phương thức: ${briefFilled})`);
      } else {
        console.warn(' -> Không tìm thấy ô nhập tóm tắt bài viết!');
      }

      // ==========================================
      // BƯỚC 4: Nhập Nội dung bài viết
      // ==========================================
      console.log(' - Đang nhập nội dung bài viết...');
      const contentFilled = await page.evaluate((articleContent) => {
        if (window.CKEDITOR && window.CKEDITOR.instances) {
          const targetInstance = Object.values(window.CKEDITOR.instances).find(inst => {
            return inst.name && (inst.name.includes('content') || 
                   (inst.element && inst.element.$ && inst.element.$.name === 'fields[content]'));
          });
          if (targetInstance) {
            targetInstance.setData(articleContent);
            return 'ckeditor-js-by-name';
          }
          const instances = Object.keys(window.CKEDITOR.instances);
          if (instances.length > 1) {
            window.CKEDITOR.instances[instances[1]].setData(articleContent);
            return 'ckeditor-js-index-1';
          } else if (instances.length > 0) {
            window.CKEDITOR.instances[instances[0]].setData(articleContent);
            return 'ckeditor-js-index-0';
          }
        }
        const labels = Array.from(document.querySelectorAll('label, div, span')).filter(el => {
          return el.innerText.trim().startsWith('Nội dung');
        });
        for (const label of labels) {
          let container = label.parentElement;
          if (container) {
            const iframe = container.querySelector('iframe.cke_wysiwyg_frame');
            if (iframe) {
              const doc = iframe.contentDocument || iframe.contentWindow.document;
              if (doc && doc.body) {
                doc.body.innerHTML = articleContent;
                return 'ckeditor-iframe';
              }
            }
            const editableDiv = container.querySelector('div[contenteditable="true"]');
            if (editableDiv) {
              editableDiv.innerHTML = articleContent;
              return 'contenteditable-div';
            }
            const textarea = container.querySelector('textarea');
            if (textarea) {
              textarea.value = articleContent;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              textarea.dispatchEvent(new Event('change', { bubbles: true }));
              return 'textarea';
            }
          }
        }
        const firstIframe = document.querySelector('iframe.cke_wysiwyg_frame');
        if (firstIframe) {
          const doc = firstIframe.contentDocument || firstIframe.contentWindow.document;
          if (doc && doc.body) {
            doc.body.innerHTML = articleContent;
            return 'ckeditor-iframe-fallback';
          }
        }
        const firstTextarea = document.querySelector('textarea[name*="content"], textarea[name*="nội dung"], textarea#content');
        if (firstTextarea) {
          firstTextarea.value = articleContent;
          firstTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          firstTextarea.dispatchEvent(new Event('change', { bubbles: true }));
          return 'textarea-fallback';
        }
        const anyTextarea = document.querySelector('textarea');
        if (anyTextarea) {
          anyTextarea.value = articleContent;
          anyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          return 'any-textarea-fallback';
        }
        return null;
      }, (function() {
        const rawContent = article['Nội dung'] || '';
        // Chuyển đổi \n\n thành các thẻ <p> để CKEditor nhận diện đúng các đoạn văn
        return rawContent.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
      })());
      if (contentFilled) {
        console.log(` - Đã điền nội dung thành công (phương thức: ${contentFilled})`);
      } else {
        console.warn(' [Cảnh báo] Không tìm thấy ô nhập nội dung phù hợp!');
      }

      // ==========================================
      // BƯỚC 5: Tải file đính kèm gốc lên mục "Danh sách file"
      // ==========================================
      console.log(' - Đang chuẩn bị tải file đính kèm...');
      const fileInput = await page.$('td.file-upload input[type="file"]');
      if (fileInput) {
        const fileNameOnly = article['Tên File'];
        const absoluteFilePath = path.resolve(INPUT_DIR, fileNameOnly);
        
        let uploadFilePath = absoluteFilePath;
        let uploadFileName = fileNameOnly;
        let isTemporaryFile = false;

        // Đối với file .txt, cần nhân bản thành .doc để bỏ qua bộ lọc định dạng file của CMS
        if (fileNameOnly.toLowerCase().endsWith('.txt')) {
          uploadFilePath = absoluteFilePath.replace(/\.txt$/i, '.doc');
          uploadFileName = fileNameOnly.replace(/\.txt$/i, '.doc');
          await fs.copyFile(absoluteFilePath, uploadFilePath);
          isTemporaryFile = true;
        }
        
        await page.evaluate((name) => {
          const nameInput = document.querySelector('input[placeholder="Tên file"]');
          if (nameInput) {
            nameInput.value = name;
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            nameInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, uploadFileName);

        await fileInput.uploadFile(uploadFilePath);
        console.log(` -> Bắt đầu tải lên: ${uploadFilePath}`);

        console.log(' -> Đang chờ upload hoàn tất...');
        const uploadDone = await page.waitForFunction(() => {
          const hiddenInput = document.querySelector('input[name^="fields[otherFiles]"][name$="[file]"]');
          return hiddenInput && hiddenInput.value !== '';
        }, { timeout: 20000 }).then(() => true).catch(() => false);

        if (uploadDone) {
          console.log(' -> Đã upload file đính kèm thành công.');
        } else {
          console.warn(' -> Quá hạn chờ file upload đính kèm (hoặc upload thất bại).');
        }

        if (isTemporaryFile) {
          try {
            await fs.unlink(uploadFilePath);
          } catch (e) {}
        }
      } else {
        console.warn(' -> Không tìm thấy nút tải file đính kèm.');
      }

      // ==========================================
      // BƯỚC 6: Thiết lập Tác giả từ file cấu hình
      // ==========================================
      if (article['Tác giả']) {
        console.log(` - Đang điền tác giả: "${article['Tác giả']}"...`);
        const authorSet = await page.evaluate((authorName) => {
          const selectEl = document.querySelector('select[name="fields[author]"]');
          if (selectEl) {
            let option = Array.from(selectEl.options).find(opt => opt.value === authorName);
            if (!option) {
              option = document.createElement('option');
              option.value = authorName;
              option.text = authorName;
              selectEl.appendChild(option);
            }
            selectEl.value = authorName;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            if (window.jQuery) {
              window.jQuery(selectEl).val(authorName).trigger('change');
            }
            return true;
          }
          return false;
        }, article['Tác giả']);
        if (authorSet) {
          console.log(' -> Đã thiết lập tác giả.');
        } else {
          console.warn(' -> Không tìm thấy selector tác giả.');
        }
      }


      // Đồng bộ dữ liệu từ rich editor (CKEditor) về textarea gốc trước khi gửi
      console.log(' - Đang đồng bộ hóa dữ liệu từ CKEditor...');
      await page.evaluate(() => {
        if (window.CKEDITOR && window.CKEDITOR.instances) {
          Object.values(window.CKEDITOR.instances).forEach(inst => {
            inst.updateElement();
          });
        }
      });

      // 4. Tìm và click nút "Lưu" để đăng bài (nút này không hiện popup xác nhận như nút "Xuất bản", nhưng lưu với trạng thái status = 1 xuất bản y hệt)
      console.log(' - Đang thực hiện lưu và xuất bản bài viết...');
      const clickedSave = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a'));
        // Ưu tiên nút có chữ "Lưu" chính xác để tránh popup xác nhận của "Xuất bản"
        const saveBtn = buttons.find(btn => {
          const text = (btn.textContent || '').trim();
          return text === 'Lưu' && (btn.className.includes('btn-save') || btn.className.includes('btn-action-primary'));
        });
        
        if (saveBtn) {
          saveBtn.click();
          return 'Lưu';
        }
        
        // Dự phòng 1: Nút "Xuất bản" (nếu không thấy nút Lưu)
        const publishBtn = buttons.find(btn => {
          const text = (btn.textContent || '').trim();
          return text === 'Xuất bản';
        });
        if (publishBtn) {
          publishBtn.click();
          // Nếu có popup xuất hiện, hàm VHV.confirm sẽ được kích hoạt, ta sẽ click Xác nhận trong modal ở phần sau
          return 'Xuất bản';
        }
        
        // Dự phòng 2: Tự động chạy script submit
        if (window.jQuery) {
          window.jQuery('#form2000 [name="fields[status]"]').val(1);
          window.jQuery('#form2000').submit();
          return 'Submit form (jQuery)';
        }
        
        return null;
      });

      if (clickedSave) {
        console.log(` - Đã gửi lệnh lưu qua nút "${clickedSave}" thành công. Chờ xử lý hoàn tất...`);
        // Đợi 5 giây để CMS xử lý lưu bài và chuyển hướng
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Dự phòng nếu có custom modal xác nhận từ nút "Xuất bản" chưa được đóng
        await page.evaluate(() => {
          const confirmBtn = Array.from(document.querySelectorAll('.modal-dialog button, .modal button, .btn-action-primary, button')).find(btn => {
            const text = (btn.textContent || '').trim();
            return text === 'Xuất bản' || text === 'Đồng ý' || text === 'Xác nhận';
          });
          if (confirmBtn) {
            confirmBtn.click();
          }
        }).catch(() => {});
      } else {
        console.warn(' [Cảnh báo] Không tìm thấy nút Lưu/Đăng bài nào phù hợp. Vui lòng kiểm tra lại giao diện.');
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
    }

    console.log('\n[Hoàn tất] Đã xử lý và đăng tải tất cả các bài báo lên CMS.');
  } catch (error) {
    console.error('[Lỗi] Có lỗi xảy ra trong quá trình tự động hóa Puppeteer:', error);
  } finally {
    // Chờ thêm 5 giây trước khi đóng trình duyệt để người dùng nhìn thấy trạng thái cuối cùng
    console.log(' - Trình duyệt sẽ đóng sau 5 giây nữa...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
  }
}

/**
 * Hàm điều khiển luồng chính (Main workflow)
 */
async function main() {
  console.log('================================================================');
  console.log('BẮT ĐẦU LUỒNG TỰ ĐỘNG HÓA BIÊN TẬP VÀ ĐĂNG BÀI CMS');
  console.log('================================================================');

  try {
    // Đọc thông tin cấu hình và API key từ key.txt trước tiên
    const credentials = await loadCredentials(KEY_FILE);
    const apiKey = credentials.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('Chưa tìm thấy khóa API. Vui lòng thiết lập biến môi trường GEMINI_API_KEY hoặc cấu hình thuộc tính GEMINI_API_KEY trong file key.txt.');
    }

    // Tác vụ 1: Đọc nội dung văn bản thô
    const rawFiles = await readTextFiles(INPUT_DIR);
    if (rawFiles.length === 0) {
      console.log('Không tìm thấy tệp văn bản thô nào để biên tập. Kết thúc.');
      return;
    }

    // Tác vụ 2: Biên tập bài báo sử dụng Gemini SDK
    console.log('\n[Tác vụ 2] Bắt đầu gửi nội dung thô cho Gemini để biên tập...');
    const editedArticles = [];
    for (const file of rawFiles) {
      console.log(`\nBiên tập tệp: ${file.fileName}...`);
      try {
        const edited = await editArticleWithGemini(file.rawContent, apiKey);
        editedArticles.push({
          fileName: file.fileName,
          title: edited.title,
          brief: edited.brief,
          content: edited.content
        });
        console.log(` -> Biên tập xong bài: "${edited.title}"`);
      } catch (geminiError) {
        console.error(` -> Lỗi biên tập tệp ${file.fileName}:`, geminiError.message);
        // Có thể tiếp tục với file khác nếu một file bị lỗi
      }
    }

    if (editedArticles.length === 0) {
      console.log('Không biên tập được bài viết nào thành công. Kết thúc.');
      return;
    }

    // Tác vụ 3: Đóng gói và lưu kết quả JSON
    const authorName = credentials.Tacgia || 'AI Editor';
    await saveToJSON(editedArticles, OUTPUT_JSON, authorName);

    // Tác vụ 4: Tự động đăng nhập và điền dữ liệu vào CMS bằng Puppeteer
    console.log('\n[Tác vụ 4.1] Đăng bài lên hệ thống 1 (vpubnd.quangngai.gov.vn)...');
    await publishToCMS(OUTPUT_JSON, credentials);

    if (credentials.URL_LOGIN_2) {
      console.log('\n[Tác vụ 4.2] Đăng bài lên hệ thống 2 (quangngai.gov.vn)...');
      const credentials2 = {
        ...credentials,
        URL_LOGIN: credentials.URL_LOGIN_2,
        URL_CREATE: credentials.URL_CREATE_2 || credentials.URL_LOGIN_2
      };
      await publishToCMS(OUTPUT_JSON, credentials2);
    }

    // Tác vụ 5: Chuyển các file đã xử lý thành công vào thư mục lưu trữ
    console.log('\n[Tác vụ 5] Chuyển các file đã xử lý vào thư mục lưu trữ...');
    try {
      await fs.access(ARCHIVE_DIR).catch(() => fs.mkdir(ARCHIVE_DIR, { recursive: true }));
      for (const article of editedArticles) {
        const sourcePath = path.join(INPUT_DIR, article.fileName);
        const destPath = path.join(ARCHIVE_DIR, article.fileName);
        try {
          // Kiểm tra xem file nguồn có tồn tại không
          await fs.access(sourcePath);
          await fs.rename(sourcePath, destPath);
          console.log(` -> Đã chuyển file: ${article.fileName} sang ${ARCHIVE_DIR}`);
        } catch (e) {
          console.error(` -> Không thể chuyển file ${article.fileName}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[Lỗi] Không thể tạo thư mục lưu trữ ${ARCHIVE_DIR}:`, e);
    }

  } catch (error) {
    console.error('\n[Lỗi Nghiêm Trọng] Quy trình tự động hóa bị gián đoạn:', error);
  } finally {
    console.log('\n================================================================');
    console.log('KẾT THÚC CHƯƠNG TRÌNH TỰ ĐỘNG HÓA');
    console.log('================================================================');
  }
}

// Chạy chương trình chính
main();
