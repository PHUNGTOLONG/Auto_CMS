import fs from 'fs/promises';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';
import 'dotenv/config';

// Nhận username từ đối số dòng lệnh
const username = process.argv[2];
if (!username) {
  console.error("Lỗi: Thiếu tham số tên người dùng!");
  process.exit(1);
}

const KEY_FILE = path.resolve(`./data/users/${username}/config.json`);

async function loadCredentials(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`[Lỗi] Không thể đọc hoặc phân tích cấu hình ${filePath}:`, error);
    throw error;
  }
}

async function sendEmailReport(credentials, reportContent) {
  if (!credentials.EMAIL_SENDER || !credentials.EMAIL_PASSWORD || !credentials.EMAIL_RECEIVER) {
    console.warn(' [Cảnh báo] Chưa cấu hình đầy đủ thông tin gửi email trong key.txt. Bỏ qua gửi email.');
    console.log('\n--- BÁO CÁO ---\n' + reportContent + '\n---------------');
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: credentials.EMAIL_SENDER,
        pass: credentials.EMAIL_PASSWORD
      }
    });

    const mailOptions = {
      from: credentials.EMAIL_SENDER,
      to: credentials.EMAIL_RECEIVER,
      subject: '[CMS Bot] Báo cáo kiểm duyệt tin tức',
      text: reportContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(` - Đã gửi báo cáo qua email thành công tới ${credentials.EMAIL_RECEIVER}. ID: ${info.messageId}`);
  } catch (error) {
    console.error(' [Lỗi] Không thể gửi email:', error.message);
  }
}

async function reviewArticleWithGemini(title, content, apiKey, type = 'news') {
  const ai = new GoogleGenAI({ apiKey });
  let systemContext = '';
  if (type === 'video') {
    systemContext = `Đây là một bài đăng dạng "Video clip" (nội dung chính là video đính kèm). Do đó, phần Nội dung văn bản có thể trống hoặc rất ngắn. Bạn chỉ cần tập trung kiểm tra Tiêu đề có lỗi chính tả, ngữ pháp nghiêm trọng nào không. Đừng từ chối chỉ vì phần Nội dung văn bản trống. Chấp nhận các tiền tố viết bằng tiếng Anh như "Inforgraphic:" hoặc "Infographic:" và các biến thể tương tự (không coi đây là lỗi chính tả). Nếu tiêu đề chứa các từ như 'nháp', 'nhap', 'test', 'demo', 'thử nghiệm', bạn vẫn duyệt xuất bản bình thường (true).`;
  } else if (type === 'pdf') {
    systemContext = `Đây là một bài đăng dạng tài liệu "PDF" hoặc "Infographic" (nội dung chính nằm trong file đính kèm). Do đó, phần Nội dung văn bản có thể trống hoặc rất ngắn. Bạn chỉ cần tập trung kiểm tra Tiêu đề có lỗi chính tả, ngữ pháp nghiêm trọng nào không. Đừng từ chối chỉ vì phần Nội dung văn bản trống. Chấp nhận các tiền tố viết bằng tiếng Anh như "Inforgraphic:" hoặc "Infographic:" và các biến thể tương tự (không coi đây là lỗi chính tả). Nếu tiêu đề chứa các từ như 'nháp', 'nhap', 'test', 'demo', 'thử nghiệm', bạn vẫn duyệt xuất bản bình thường (true).`;
  } else {
    systemContext = `Đây là một bài viết tin tức thông thường. Hãy kiểm tra cả Tiêu đề và Nội dung bài viết. Chấp nhận các tiền tố viết bằng tiếng Anh như "Inforgraphic:" hoặc "Infographic:" và các biến thể tương tự (không coi đây là lỗi chính tả). Nếu tiêu đề chứa các từ như 'nháp', 'nhap', 'test', 'demo', 'thử nghiệm', bạn vẫn duyệt xuất bản bình thường (true).
Lưu ý quy tắc bố cục đặc biệt: Câu thông tin ký ban hành quyết định/kế hoạch (ví dụ: "Thay mặt UBND tỉnh, Phó Chủ tịch Nguyễn Công Hoàng ký ban hành kế hoạch này" hoặc các câu có ý nghĩa tương tự về việc ký ban hành) tuyệt đối KHÔNG được viết ở cuối phần Nội dung bài viết. Nếu phát hiện câu như vậy ở cuối phần Nội dung bài viết, hãy đánh giá KHÔNG ĐẠT (isApproved = false) và ghi lý do rõ ràng yêu cầu chuyển câu ký ban hành này lên phần tóm tắt (brief) của bài viết.`;
  }

  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const prompt = `Bạn là một Tổng biên tập báo chí. Nhiệm vụ của bạn là kiểm tra bài đăng sau về các lỗi: Chính tả, văn phong, logic và ngữ pháp nghiêm trọng.
Lưu ý quan trọng về thời gian: Hiện tại đang là năm ${today.getFullYear()} (ngày ${todayStr}). Do đó, các mốc thời gian đề cập đến năm ${today.getFullYear() - 1} trở về trước là trong quá khứ, hoàn toàn hợp lệ về mặt logic và thời gian, không được coi đây là lỗi logic thời gian.
${systemContext}

Tiêu đề:
${title}

Nội dung:
${content}

Hãy trả về kết quả định dạng JSON với cấu trúc:
{
  "isApproved": boolean, // true nếu chấp nhận xuất bản (không có lỗi nghiêm trọng), false nếu có lỗi nghiêm trọng cần sửa.
  "reason": "string" // Lý do nếu không duyệt. Nếu duyệt thì để trống hoặc ghi "OK".
}
Tuyệt đối không giải thích gì thêm ngoài cấu trúc JSON.`;

  const model = 'gemini-3.5-flash';
  const config = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        isApproved: { type: 'BOOLEAN' },
        reason: { type: 'STRING' }
      },
      required: ['isApproved', 'reason']
    }
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config
      });
      const resultText = response.text;
      return JSON.parse(resultText);
    } catch (error) {
      lastError = error;
      const errMsg = error.message || '';
      const isTransient = error.status === 429 || 
                          error.status === '429' || 
                          error.status === 503 || 
                          error.status === '503' || 
                          error.status === 500 || 
                          error.status === '500' || 
                          errMsg.includes('429') || 
                          errMsg.toLowerCase().includes('quota') || 
                          errMsg.includes('RESOURCE_EXHAUSTED') || 
                          errMsg.toLowerCase().includes('unavailable') || 
                          errMsg.toLowerCase().includes('temporary') || 
                          errMsg.toLowerCase().includes('overloaded');
      
      if (isTransient) {
        let waitMs = 30000; // Mặc định đợi 30 giây cho lỗi tạm thời khác
        if (error.status === 429 || error.status === '429' || errMsg.includes('429')) {
          waitMs = 60000;
          const match = errMsg.match(/Please retry in ([\d.]+)s/i);
          if (match) {
            waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 5000; // Cộng thêm 5 giây buffer
          }
        }
        console.warn(` - [Cảnh báo] Lỗi tạm thời (status ${error.status || 'unknown'} / rate limit). Đang đợi ${Math.round(waitMs / 1000)} giây trước khi thử lại lần ${attempt}/5...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      console.error(' - Lỗi khi gọi Gemini API:', errMsg);
      break;
    }
  }
  return { isApproved: false, reason: 'Lỗi khi kết nối AI sau nhiều lần thử: ' + (lastError ? lastError.message : 'Không rõ lỗi') };
}

async function main() {
  console.log('BẮT ĐẦU KIỂM DUYỆT TIN TỨC "CHỜ XUẤT BẢN"');
  let credentials;
  try {
    credentials = await loadCredentials(KEY_FILE);
  } catch (e) {
    console.error('Không thể tải file cấu hình:', e);
    return;
  }

  const apiKey = credentials.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Chưa có GEMINI_API_KEY');
    return;
  }

  const sites = [
    {
      name: "Trang 1: vpubnd.quangngai.gov.vn",
      loginUrl: credentials.URL_LOGIN,
      listUrl: credentials.URL_CREATE || credentials.URL_LOGIN
    },
    {
      name: "Trang 2: quangngai.gov.vn (Tin tức)",
      loginUrl: credentials.URL_LOGIN_2 || credentials.URL_LOGIN,
      listUrl: credentials.URL_CREATE_2 || credentials.URL_LOGIN_2 || credentials.URL_LOGIN
    },
    {
      name: "Trang 2: quangngai.gov.vn (Video clip)",
      loginUrl: credentials.URL_LOGIN_2 || credentials.URL_LOGIN,
      listUrl: (credentials.URL_LOGIN_2 || credentials.URL_LOGIN).replace(/\/list\?.*/, "/list") + "?&type=Article.Video&groupId=6507ab578946ed4b360cf4e4&id=Article.Video&menuId=Article.Video"
    },
    {
      name: "Trang 2: quangngai.gov.vn (Pdf)",
      loginUrl: credentials.URL_LOGIN_2 || credentials.URL_LOGIN,
      listUrl: (credentials.URL_LOGIN_2 || credentials.URL_LOGIN).replace(/\/list\?.*/, "/list") + "?&type=Article.PDF&groupId=6507ab578946ed4b360cf4e4&id=Article.PDF&menuId=Article.PDF"
    },
    {
      name: "Trang 2: quangngai.gov.vn (Infographic)",
      loginUrl: credentials.URL_LOGIN_2 || credentials.URL_LOGIN,
      listUrl: (credentials.URL_LOGIN_2 || credentials.URL_LOGIN).replace(/\/list\?.*/, "/list") + "?&type=Article.Infographic&groupId=6507ab578946ed4b360cf4e4&id=Article.Infographic&menuId=Article.Infographic"
    }
  ];

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(90000); // Thiết lập timeout điều hướng tối đa 90 giây
  page.on('dialog', async dialog => {
    await dialog.accept().catch(() => {});
  });

  let reportBody = "BÁO CÁO KIỂM DUYỆT BÀI VIẾT TỰ ĐỘNG:\n\n";
  let totalApproved = 0;
  let totalErrors = 0;

  try {
    for (const site of sites) {
      console.log(`\n========================================`);
      console.log(`ĐANG XỬ LÝ: ${site.name}`);
      console.log(`========================================`);
      
      reportBody += `--- ${site.name} ---\n`;
      
      // 1. Đăng nhập
      console.log(` - Điều hướng đến trang đăng nhập: ${site.loginUrl}`);
      try {
        await page.goto(site.loginUrl, { waitUntil: 'load', timeout: 60000 });
      } catch (err) {
        console.warn(` [Cảnh báo] Lỗi điều hướng trang đăng nhập: ${err.message}. Tiếp tục xử lý...`);
      }
      
      const usernameInput = await page.$('input[name="fields[username]"]');
      const isLoginVisible = usernameInput ? await page.evaluate(el => {
        return el.offsetWidth > 0 && el.offsetHeight > 0;
      }, usernameInput) : false;

      if (isLoginVisible) {
        console.log(' - Thực hiện đăng nhập...');
        await page.type('input[name="fields[username]"]', credentials.USERNAME);
        await page.type('input[name="fields[password]"]', credentials.PASSWORD);
        await page.click('input.btn-login');
        await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
      } else {
        console.log(' - Đã đăng nhập từ trước hoặc form đăng nhập ẩn. Bỏ qua bước đăng nhập.');
      }

      // Vòng lặp xử lý các bài viết trên trang hiện tại
      const processedIds = new Set();
      let hasPendingArticles = true;

      while (hasPendingArticles) {
        // 2. Chuyển sang trang danh sách bài viết
        const cleanListUrl = site.listUrl
          .replace(/[?&]clickEditForm=[^&]*/g, '')
          .replace(/\?&/g, '?')
          .replace(/\?$/g, '');
        console.log(` - Điều hướng đến trang danh sách: ${cleanListUrl}`);
        try {
          await page.goto(cleanListUrl, { waitUntil: 'load', timeout: 60000 });
        } catch (err) {
          console.warn(` [Cảnh báo] Lỗi điều hướng trang danh sách: ${err.message}. Tiếp tục xử lý...`);
        }

        // Đánh dấu các hàng cũ để nhận biết khi bảng tải xong dữ liệu mới
        await page.evaluate(() => {
          const tbody = document.querySelector('table.dataTable tbody, table tbody');
          if (tbody) {
            Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
              tr.classList.add('old-row');
            });
          }
        });

        // 3. Lọc theo trạng thái "Chờ xuất bản"
        console.log(' - Đang thiết lập bộ lọc "Chờ xuất bản"...');
        await page.evaluate(() => {
          const selects = Array.from(document.querySelectorAll('select'));
          for (const sel of selects) {
            const options = Array.from(sel.options);
            const waitingOpt = options.find(o => o.text.toLowerCase().trim() === 'chờ xuất bản');
            if (waitingOpt) {
              sel.value = waitingOpt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              if (window.jQuery) {
                window.jQuery(sel).val(waitingOpt.value).trigger('change');
              }
              break;
            }
          }
          
          const searchBtn = Array.from(document.querySelectorAll('a, button, input[type="button"]')).find(b => (b.innerText || b.value || '').trim() === 'Tìm kiếm');
          if (searchBtn) {
             searchBtn.click();
          }
        });

        // 4. Chờ bảng dữ liệu tải xong các hàng (AJAX)
        let rowsLoaded = false;
        let isEmpty = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          const tableStatus = await page.evaluate(() => {
            const tbody = document.querySelector('table.dataTable tbody, table tbody');
            if (!tbody) return { loaded: false, empty: false };
            const rows = Array.from(tbody.querySelectorAll('tr'));
            if (rows.length === 0) return { loaded: false, empty: false };
            
            // Nếu có hàng mới (không có old-row), tức là bảng đã cập nhật
            const hasNewRow = rows.some(tr => !tr.classList.contains('old-row'));
            if (hasNewRow) {
              const isTextEmpty = rows.some(tr => tr.innerText.includes('Không tìm thấy') || tr.innerText.includes('không tìm thấy'));
              return { loaded: true, empty: isTextEmpty };
            }
            return { loaded: false, empty: false };
          });

          if (tableStatus.loaded) {
            rowsLoaded = !tableStatus.empty;
            isEmpty = tableStatus.empty;
            break;
          }
          
          // Thêm kiểm tra jQuery active để làm fallback nếu DataTables không vẽ lại
          const isJQueryIdle = await page.evaluate(() => {
            return window.jQuery ? window.jQuery.active === 0 : true;
          });
          if (isJQueryIdle && attempt >= 5) {
            console.log('   (Bổ trợ) AJAX đã hoàn tất. Đọc dữ liệu bảng hiện tại...');
            const tableStatusFallback = await page.evaluate(() => {
              const tbody = document.querySelector('table.dataTable tbody, table tbody');
              if (!tbody) return { loaded: true, empty: true };
              const rows = Array.from(tbody.querySelectorAll('tr'));
              const isTextEmpty = rows.length === 0 || rows.some(tr => tr.innerText.includes('Không tìm thấy') || tr.innerText.includes('không tìm thấy'));
              return { loaded: true, empty: isTextEmpty };
            });
            rowsLoaded = !tableStatusFallback.empty;
            isEmpty = tableStatusFallback.empty;
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (isEmpty || !rowsLoaded) {
          console.log(' - Không còn bài viết nào ở trạng thái "Chờ xuất bản".');
          hasPendingArticles = false;
          break;
        }

        // 5. Tìm bài viết chưa được xử lý trong lượt này
        const nextArticle = await page.evaluate((processed) => {
          // Ở tất cả các mục (Tin tức, Video, PDF, Infographic), cột Trạng thái luôn là cột thứ 6 (index 5)
          const statusColIndex = 5;

          const rows = document.querySelectorAll('table.dataTable tbody tr, table tbody tr');
          for (const row of rows) {
            const checkbox = row.querySelector('input[type="checkbox"]');
            const id = checkbox ? (checkbox.getAttribute('data-id') || checkbox.value) : row.getAttribute('data-id');
            if (id && id !== 'on' && id.length > 5 && !processed.includes(id)) {
              // Kiểm tra cột trạng thái có chính xác là "Chờ xuất bản" hay không
              const tds = Array.from(row.querySelectorAll('td'));
              if (tds.length > statusColIndex) {
                const statusText = tds[statusColIndex].innerText.trim().toLowerCase();
                if (statusText !== 'chờ xuất bản') {
                  continue; // Bỏ qua nếu không phải "Chờ xuất bản"
                }
              } else {
                continue; // Tránh lỗi cấu trúc bảng
              }

              // Trích xuất tiêu đề bằng cách kiểm tra thuộc tính data-title hoặc thẻ b
              const titleText = (checkbox ? checkbox.getAttribute('data-title') : null) || 
                                (row.querySelector('.col-right-cont b') ? row.querySelector('.col-right-cont b').innerText.trim() : null) ||
                                (row.querySelector('b') ? row.querySelector('b').innerText.trim() : 'Không rõ tiêu đề');
              return {
                id: id,
                titleText: titleText
              };
            }
          }
          return null;
        }, Array.from(processedIds));

        if (!nextArticle) {
          console.log(' - Tất cả các bài viết trên trang này đã được kiểm duyệt trong phiên này.');
          hasPendingArticles = false;
          break;
        }

        console.log(`\n -> Phát hiện bài viết cần duyệt: "${nextArticle.titleText}" (ID: ${nextArticle.id})`);
        processedIds.add(nextArticle.id);

        // Kiểm tra xem bài đăng này có thuộc Video clip (không cho phép click chỉnh sửa) hay không
        const isVideo = site.name.toLowerCase().includes('video');

        if (isVideo) {
          console.log(`   - Đây là mục Video clip. Tiến hành duyệt trực tiếp từ danh sách (không mở trang soạn thảo)...`);
          console.log('   - Đang gửi tiêu đề sang Gemini AI kiểm duyệt...');
          const reviewResult = await reviewArticleWithGemini(nextArticle.titleText, '', apiKey, 'video');

          if (reviewResult.isApproved) {
            console.log('   - AI Đánh giá: ĐẠT YÊU CẦU. Thực hiện xuất bản từ menu hành động...');
            
            // Mở dropdown "Hành động khác" của dòng hiện tại
            const dropdownOpened = await page.evaluate((targetId) => {
              const rows = Array.from(document.querySelectorAll('table.dataTable tbody tr, table tbody tr'));
              const row = rows.find(r => {
                const checkbox = r.querySelector('input[type="checkbox"]');
                const rowId = checkbox ? (checkbox.getAttribute('data-id') || checkbox.value) : r.getAttribute('data-id');
                return rowId === targetId;
              });
              if (row) {
                const dotsBtn = row.querySelector('a.action-admin-v2');
                if (dotsBtn) {
                  dotsBtn.click();
                  return true;
                }
              }
              return false;
            }, nextArticle.id);

            if (!dropdownOpened) {
              console.error('     => Không thể mở dropdown hành động khác.');
              reportBody += `[LỖI] Bài viết: "${nextArticle.titleText}"\n      Lý do: Không mở được dropdown hành động khác trên danh sách.\n\n`;
              totalErrors++;
              continue;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            // Click "Xuất bản" trong dropdown menu
            const clickedPublish = await page.evaluate((targetId) => {
              const rows = Array.from(document.querySelectorAll('table.dataTable tbody tr, table tbody tr'));
              const row = rows.find(r => {
                const checkbox = r.querySelector('input[type="checkbox"]');
                const rowId = checkbox ? (checkbox.getAttribute('data-id') || checkbox.value) : row.getAttribute('data-id');
                return rowId === targetId;
              });
              if (row) {
                const publishItem = Array.from(row.querySelectorAll('.dropdown-item'))
                  .find(item => item.innerText.includes('Xuất bản'));
                if (publishItem) {
                  publishItem.click();
                  return true;
                }
              }
              return false;
            }, nextArticle.id);

            if (!clickedPublish) {
              console.error('     => Không tìm thấy nút Xuất bản trong dropdown.');
              reportBody += `[LỖI] Bài viết: "${nextArticle.titleText}"\n      Lý do: Không tìm thấy nút Xuất bản trong dropdown hành động.\n\n`;
              totalErrors++;
              continue;
            }

            // Chờ lobibox xuất hiện và click nút xác nhận
            console.log('     - Chờ hộp thoại xác nhận Lobibox...');
            let lobiboxClicked = false;
            for (let attempt = 0; attempt < 10; attempt++) {
              lobiboxClicked = await page.evaluate(() => {
                const lobibox = document.querySelector('.lobibox-confirm');
                if (lobibox) {
                  const confirmBtn = lobibox.querySelector('button[data-type="yes"], button.lobibox-btn-yes, button.btn-action-primary');
                  if (confirmBtn) {
                    confirmBtn.click();
                    return true;
                  }
                }
                return false;
              });
              if (lobiboxClicked) break;
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (lobiboxClicked) {
              console.log('     - Đã click "Xuất bản" trên hộp thoại xác nhận. Chờ xử lý...');
              await new Promise(resolve => setTimeout(resolve, 5000)); // Đợi 5 giây cho AJAX load và lưu dữ liệu
              console.log('     => Đã duyệt và xuất bản thành công qua menu hành động.');
              totalApproved++;
              reportBody += `[THÀNH CÔNG] Video: "${nextArticle.titleText}"\n      Đã duyệt đạt và bấm Xuất bản trực tiếp trên danh sách.\n\n`;
            } else {
              console.error('     => Không xuất hiện hoặc không click được nút xác nhận Lobibox.');
              reportBody += `[LỖI] Bài viết: "${nextArticle.titleText}"\n      Lý do: Hộp thoại xác nhận Xuất bản không xuất hiện hoặc lỗi click.\n\n`;
              totalErrors++;
            }
          } else {
            console.log(`   - AI Đánh giá: KHÔNG ĐẠT. Lý do: ${reviewResult.reason}`);
            totalErrors++;
            reportBody += `[BỎ QUA] Video: "${nextArticle.titleText}"\n      Lý do: ${reviewResult.reason}\n\n`;
          }

          continue; // Bỏ qua phần còn lại của vòng lặp, chuyển sang hàng tiếp theo
        }

        // 6. Click nút Sửa của bài viết đó (đối với News, PDF, Infographic) với chế độ thử lại nếu chậm
        let formLoaded = false;
        for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
          const clicked = await page.evaluate((targetId) => {
            const rows = Array.from(document.querySelectorAll('table.dataTable tbody tr, table tbody tr'));
            for (const row of rows) {
              const checkbox = row.querySelector('input[type="checkbox"]');
              const id = checkbox ? (checkbox.getAttribute('data-id') || checkbox.value) : row.getAttribute('data-id');
              if (id === targetId) {
                const editBtn = row.querySelector('a[data-x-service="editForm"], a[title*="Chỉnh sửa"], a.btn-action');
                if (editBtn) {
                  editBtn.click();
                  return true;
                }
                const editLink = Array.from(row.querySelectorAll('a')).find(a => {
                  const title = (a.getAttribute('title') || '').toLowerCase();
                  const action = (a.getAttribute('data-x-action') || '').toLowerCase();
                  return title.includes('sửa') || title.includes('chỉnh') || action.includes('edit') || a.querySelector('.vi-pencil');
                });
                if (editLink) {
                  editLink.click();
                  return true;
                }
              }
            }
            return false;
          }, nextArticle.id);

          if (!clicked) {
            console.error('   => Không thể tìm thấy hoặc click nút chỉnh sửa.');
            break;
          }

          // Chờ trang soạn thảo mở ra
          const titleSelector = 'input[name="fields[title]"], input[name="title"], input#title';
          formLoaded = await page.waitForSelector(titleSelector, { timeout: 10000 }).then(() => true).catch(() => false);
          if (formLoaded) break;
          console.warn(`   - Thử lại click nút Sửa lần ${clickAttempt + 2}...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!formLoaded) {
          console.warn('   [Cảnh báo] Form soạn thảo không xuất hiện kịp thời.');
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, 3000)); // Chờ các editor tải hoàn tất

        // Trích xuất tiêu đề và nội dung
        const { title, content } = await page.evaluate(() => {
          let t = '';
          const titleInput = document.querySelector('input[name="fields[title]"], input[name="title"], input#title');
          if (titleInput) t = titleInput.value;

          let c = '';
          if (window.CKEDITOR && window.CKEDITOR.instances) {
            const instKeys = Object.keys(window.CKEDITOR.instances);
            const contentInstKey = instKeys.find(k => k.includes('content') || (window.CKEDITOR.instances[k].element && window.CKEDITOR.instances[k].element.$.name.includes('content')));
            if (contentInstKey) {
              c = window.CKEDITOR.instances[contentInstKey].getData();
            } else if (instKeys.length > 0) {
              c = window.CKEDITOR.instances[instKeys[instKeys.length - 1]].getData();
            }
          }

          // Fallbacks cho nội dung nếu CKEDITOR không có hoặc rỗng
          if (!c) {
            const firstIframe = document.querySelector('iframe.cke_wysiwyg_frame');
            if (firstIframe) {
              const doc = firstIframe.contentDocument || firstIframe.contentWindow.document;
              if (doc && doc.body) {
                c = doc.body.innerHTML;
              }
            }
          }
          if (!c) {
            const editableDiv = document.querySelector('div[contenteditable="true"]');
            if (editableDiv) {
              c = editableDiv.innerHTML;
            }
          }
          if (!c) {
            const textarea = document.querySelector('textarea[name*="content"], textarea[name*="nội dung"], textarea#content, textarea');
            if (textarea) {
              c = textarea.value;
            }
          }

          const tmp = document.createElement('div');
          tmp.innerHTML = c;
          c = tmp.textContent || tmp.innerText || "";
          
          return { title: t, content: c.trim() };
        });

        if (!title && !content) {
          console.warn('   [Cảnh báo] Không trích xuất được tiêu đề hoặc nội dung.');
          reportBody += `[BỎ QUA] ID: ${nextArticle.id}\n      Lý do: Không lấy được Tiêu đề/Nội dung để kiểm tra.\n\n`;
          totalErrors++;
          continue;
        }

        console.log(`   - Soạn thảo: "${title}"`);
        console.log('   - Đang gửi nội dung sang Gemini AI kiểm duyệt...');

        let type = 'news';
        if (site.name.includes('Video clip')) {
          type = 'video';
        } else if (site.name.includes('Pdf') || site.name.includes('Infographic')) {
          type = 'pdf';
        }

        const reviewResult = await reviewArticleWithGemini(title, content, apiKey, type);

        if (reviewResult.isApproved) {
          console.log('   - AI Đánh giá: ĐẠT YÊU CẦU. Tiến hành kiểm tra Trạng thái và Lưu...');
          
          // 1. Kiểm tra và chọn option thích hợp trong select Trạng thái trên edit form
          await page.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            let statusSelect = null;
            const labels = Array.from(document.querySelectorAll('label, div, span'));
            const statusLabel = labels.find(el => el.innerText.trim() === 'Trạng thái');
            if (statusLabel) {
              const parent = statusLabel.parentElement;
              if (parent) {
                statusSelect = parent.querySelector('select');
              }
            }
            if (!statusSelect) {
              statusSelect = selects.find(sel => sel.name === 'fields[status]' || sel.name === 'fields[isDisplay]');
            }
            
            if (statusSelect) {
              const options = Array.from(statusSelect.options);
              const pubOpt = options.find(o => {
                const txt = o.text.toLowerCase().trim();
                return txt === 'hiển thị bài viết' || txt === 'hiển thị công khai' || txt === 'xuất bản';
              });
              if (pubOpt) {
                statusSelect.value = pubOpt.value;
                statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
                if (window.jQuery) {
                  window.jQuery(statusSelect).val(pubOpt.value).trigger('change');
                }
              }
            }
          });

          // Chuẩn bị promise lắng nghe chuyển hướng trước khi click Xuất bản
          const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 35000 }).catch(() => null);

          // 2. Click nút "Xuất bản" trên form soạn thảo
          const clickedPublish = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            // Tìm nút có text chính xác là "Xuất bản" và không phải là dropdown item của menu danh sách
            const pubBtn = btns.find(b => {
              const text = (b.innerText || '').trim();
              return text === 'Xuất bản' && !b.classList.contains('dropdown-item') && !b.classList.contains('action');
            });
            if (pubBtn) {
              pubBtn.click();
              return true;
            }
            return false;
          });

          if (clickedPublish) {
            console.log('   - Đã click nút "Xuất bản" trên form. Chờ hộp thoại xác nhận Lobibox...');
            
            // Chờ hộp thoại xác nhận Lobibox xuất hiện và click xác nhận
            let lobiboxClicked = false;
            for (let attempt = 0; attempt < 10; attempt++) {
              lobiboxClicked = await page.evaluate(() => {
                const lobibox = document.querySelector('.lobibox-confirm');
                if (lobibox) {
                  const confirmBtn = lobibox.querySelector('button[data-type="yes"], button.lobibox-btn-yes, button.btn-action-primary');
                  if (confirmBtn) {
                    confirmBtn.click();
                    return true;
                  }
                }
                return false;
              });
              if (lobiboxClicked) break;
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (lobiboxClicked) {
              console.log('   - Đã click "Xuất bản" trên hộp thoại xác nhận. Chờ lưu dữ liệu và điều hướng thành công...');
              await navigationPromise;
              await new Promise(resolve => setTimeout(resolve, 3000)); // Đợi thêm 3s cho ổn định hẳn
              console.log('   => Đã duyệt và xuất bản thành công qua nút Xuất bản.');
              totalApproved++;
              reportBody += `[THÀNH CÔNG] Bài viết: "${title}"\n      Đã duyệt đạt và bấm Xuất bản để đăng công khai trực tiếp.\n\n`;
            } else {
              console.error('   => Không tìm thấy hoặc không click được nút xác nhận trên hộp thoại Lobibox.');
              reportBody += `[LỖI] Bài viết: "${title}"\n      Lý do: Không click được xác nhận trên hộp thoại Lobibox.\n\n`;
              totalErrors++;
            }
          } else {
            console.error('   => Không tìm thấy nút "Xuất bản" trên trang chỉnh sửa.');
            // Thử cứu cánh bằng nút "Lưu" nếu không tìm thấy nút "Xuất bản"
            console.log('   - Thử cứu cánh bằng cách click nút "Lưu"...');
            const clickedSave = await page.evaluate(() => {
              const saveBtn = document.querySelector('a.btn-save, a.btn-action-primary, button.btn-save');
              if (saveBtn) {
                saveBtn.click();
                return true;
              }
              return false;
            });
            if (clickedSave) {
              await navigationPromise;
              await new Promise(resolve => setTimeout(resolve, 3000));
              console.log('   => Đã bấm nút Lưu tạm.');
              totalApproved++;
              reportBody += `[LƯU TẠM] Bài viết: "${title}"\n      Đã duyệt đạt nhưng không tìm thấy nút Xuất bản nên đã bấm nút Lưu.\n\n`;
            } else {
              reportBody += `[LỖI] Bài viết: "${title}"\n      Lý do: AI duyệt đạt nhưng không tìm thấy nút Xuất bản/Lưu.\n\n`;
              totalErrors++;
            }
          }
        } else {
          console.log(`   - AI Đánh giá: KHÔNG ĐẠT. Lý do: ${reviewResult.reason}`);
          totalErrors++;
          reportBody += `[BỎ QUA] Bài viết: "${title}"\n      Lý do: ${reviewResult.reason}\n\n`;
        }
      }
      
      if (processedIds.size === 0) {
        reportBody += "Không có bài viết nào cần duyệt.\n\n";
      }
    }

    reportBody += `Tổng kết kiểm duyệt: Đã xuất bản (${totalApproved}), Bỏ qua/Lỗi (${totalErrors}).`;
    await sendEmailReport(credentials, reportBody);

  } catch (error) {
    console.error('Lỗi hệ thống nghiêm trọng:', error);
  } finally {
    console.log('Đóng trình duyệt sau 5 giây...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
  }
}

main();
