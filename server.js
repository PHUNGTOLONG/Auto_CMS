import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { registerUser, authenticateUser, ensureDataDirs } from './auth_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Các session hoạt động lưu trong bộ nhớ: token -> { username, createdAt }
const activeSessions = new Map();

// Trạng thái tiến trình chạy nền của từng user: username -> { process, logBuffer, status }
const activeProcesses = new Map();

// Đảm bảo các thư mục dữ liệu hệ thống tồn tại
ensureDataDirs();

// Hàm lấy hoặc khởi tạo trạng thái tiến trình của từng user
function getProcessState(username) {
  if (!activeProcesses.has(username)) {
    activeProcesses.set(username, {
      process: null,
      logBuffer: `[Hệ thống] Trình quản trị CMS Automation đã sẵn sàng cho người dùng "${username}".\n`,
      status: 'idle'
    });
  }
  return activeProcesses.get(username);
}

// Cấu hình lưu trữ file tải lên động với multer theo từng user
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const username = req.username;
      const userUploadsDir = path.resolve(__dirname, `../Vanban_CMS/${username}`);
      await fs.mkdir(userUploadsDir, { recursive: true });
      cb(null, userUploadsDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.txt' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận các file định dạng .txt hoặc .pdf.'));
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware xác thực token
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng đăng nhập lại.' });
  }

  const token = authHeader.substring(7);
  const session = activeSessions.get(token);

  if (!session) {
    return res.status(401).json({ error: 'Phiên làm việc đã hết hạn hoặc không hợp lệ.' });
  }

  req.username = session.username;
  next();
}

// -------------------------------------------------------------
// API XÁC THỰC NGƯỜI DÙNG (AUTH API)
// -------------------------------------------------------------

// 1. Đăng ký tài khoản mới
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ tên đăng nhập và mật khẩu.' });
    }
    const result = await registerUser(username, password);
    res.json({ success: true, message: 'Đăng ký tài khoản thành công.', username: result.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Đăng nhập
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ tên đăng nhập và mật khẩu.' });
    }
    const user = await authenticateUser(username, password);
    
    // Tạo token ngẫu nhiên
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, {
      username: user.username,
      createdAt: new Date().toISOString()
    });

    res.json({ success: true, token, username: user.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Đăng xuất
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    activeSessions.delete(token);
  }
  res.json({ success: true, message: 'Đăng xuất thành công.' });
});

// 4. Lấy thông tin user hiện tại
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.username });
});

// -------------------------------------------------------------
// CÁC ENDPOINT API CHỨC NĂNG (YÊU CẦU ĐĂNG NHẬP)
// -------------------------------------------------------------

// 1. Xem trạng thái và thông tin thống kê tổng quan của User
app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const username = req.username;
    const userUploadsDir = path.resolve(__dirname, `../Vanban_CMS/${username}`);
    const userFolder = path.resolve(__dirname, `./data/users/${username}`);
    const userOutputPath = path.join(userFolder, 'data_CMS.json');
    const state = getProcessState(username);

    let inputFilesCount = 0;
    try {
      if (existsSync(userUploadsDir)) {
        const files = await fs.readdir(userUploadsDir);
        inputFilesCount = files.filter(f => {
          const ext = f.toLowerCase();
          return ext.endsWith('.txt') || ext.endsWith('.pdf');
        }).length;
      }
    } catch (e) {}

    let processedCount = 0;
    try {
      if (existsSync(userOutputPath)) {
        const content = await fs.readFile(userOutputPath, 'utf-8');
        const articles = JSON.parse(content);
        processedCount = Array.isArray(articles) ? articles.length : 0;
      }
    } catch (e) {}

    res.json({
      status: state.status,
      inputFilesCount,
      processedCount,
      hasActiveProcess: state.process !== null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Lấy cấu hình CMS hiện tại của User
app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const username = req.username;
    const configPath = path.resolve(__dirname, `./data/users/${username}/config.json`);
    
    if (existsSync(configPath)) {
      const data = await fs.readFile(configPath, 'utf-8');
      res.json(JSON.parse(data));
    } else {
      res.status(404).json({ error: 'Không tìm thấy cấu hình cho người dùng này.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Cập nhật cấu hình CMS của User
app.post('/api/config', requireAuth, async (req, res) => {
  try {
    const username = req.username;
    const configPath = path.resolve(__dirname, `./data/users/${username}/config.json`);
    const newConfig = req.body;
    
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    res.json({ success: true, message: 'Đã lưu cấu hình thành công.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Lấy danh sách file trong thư mục đầu vào của User
app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const username = req.username;
    const userUploadsDir = path.resolve(__dirname, `../Vanban_CMS/${username}`);
    
    if (!existsSync(userUploadsDir)) {
      await fs.mkdir(userUploadsDir, { recursive: true });
    }

    const files = await fs.readdir(userUploadsDir);
    const filteredFiles = [];
    for (const file of files) {
      const ext = file.toLowerCase();
      if (ext.endsWith('.txt') || ext.endsWith('.pdf')) {
        const filePath = path.join(userUploadsDir, file);
        const stat = await fs.stat(filePath);
        filteredFiles.push({
          name: file,
          size: stat.size,
          createdAt: stat.birthtime
        });
      }
    }
    
    filteredFiles.sort((a, b) => b.createdAt - a.createdAt);
    res.json(filteredFiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Tải file mới lên thư mục đầu vào của User
app.post('/api/upload', requireAuth, upload.array('files'), (req, res) => {
  res.json({ success: true, message: 'Tải file lên thành công.' });
}, (error, req, res, next) => {
  res.status(400).json({ success: false, error: error.message });
});

// 6. Xóa một file thô của User
app.delete('/api/files/:filename', requireAuth, async (req, res) => {
  try {
    const username = req.username;
    const filename = req.params.filename;
    const userUploadsDir = path.resolve(__dirname, `../Vanban_CMS/${username}`);
    const filePath = path.join(userUploadsDir, filename);
    
    // Bảo mật: ngăn chặn di chuyển thư mục cha (directory traversal)
    if (!filePath.startsWith(userUploadsDir)) {
      return res.status(400).json({ error: 'Đường dẫn không hợp lệ.' });
    }

    if (existsSync(filePath)) {
      await fs.unlink(filePath);
      res.json({ success: true, message: `Đã xóa file ${filename} thành công.` });
    } else {
      res.status(404).json({ error: 'Không tìm thấy file.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Lấy danh sách bài viết đã xử lý của User
app.get('/api/articles', requireAuth, async (req, res) => {
  try {
    const username = req.username;
    const userOutputPath = path.resolve(__dirname, `./data/users/${username}/data_CMS.json`);
    
    if (existsSync(userOutputPath)) {
      const data = await fs.readFile(userOutputPath, 'utf-8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Chạy chương trình biên tập và đăng bài cho User
app.post('/api/run-editor', requireAuth, (req, res) => {
  const username = req.username;
  const state = getProcessState(username);

  if (state.process) {
    return res.status(400).json({ error: 'Tiến trình biên tập hoặc kiểm duyệt của bạn đang chạy.' });
  }

  state.logBuffer = `[Hệ thống] Bắt đầu khởi chạy: Tự động hóa Biên tập & Đăng bài cho tài khoản ${username}...\n`;
  state.status = 'running_editor';

  // Khởi chạy tiến trình con với đối số username
  const child = spawn('node', ['cms_automation_js.js', username], { cwd: __dirname });
  state.process = child;

  child.stdout.on('data', (data) => {
    state.logBuffer += data.toString();
  });

  child.stderr.on('data', (data) => {
    state.logBuffer += `[LỖI] ${data.toString()}`;
  });

  child.on('close', (code) => {
    state.logBuffer += `\n[Hệ thống] Tiến trình Biên tập hoàn tất. Mã thoát: ${code}\n`;
    state.process = null;
    state.status = 'idle';
  });

  res.json({ success: true, message: 'Đã kích hoạt trình biên tập.' });
});

// 9. Chạy chương trình kiểm duyệt bài viết cho User
app.post('/api/run-reviewer', requireAuth, (req, res) => {
  const username = req.username;
  const state = getProcessState(username);

  if (state.process) {
    return res.status(400).json({ error: 'Tiến trình biên tập hoặc kiểm duyệt của bạn đang chạy.' });
  }

  state.logBuffer = `[Hệ thống] Bắt đầu khởi chạy: Tự động hóa Kiểm duyệt bài viết cho tài khoản ${username}...\n`;
  state.status = 'running_reviewer';

  // Khởi chạy tiến trình con với đối số username
  const child = spawn('node', ['review_automation_js.js', username], { cwd: __dirname });
  state.process = child;

  child.stdout.on('data', (data) => {
    state.logBuffer += data.toString();
  });

  child.stderr.on('data', (data) => {
    state.logBuffer += `[LỖI] ${data.toString()}`;
  });

  child.on('close', (code) => {
    state.logBuffer += `\n[Hệ thống] Tiến trình Kiểm duyệt hoàn tất. Mã thoát: ${code}\n`;
    state.process = null;
    state.status = 'idle';
  });

  res.json({ success: true, message: 'Đã kích hoạt trình kiểm duyệt.' });
});

// 10. Dừng tiến trình đang chạy của User
app.post('/api/stop', requireAuth, (req, res) => {
  const username = req.username;
  const state = activeProcesses.get(username);

  if (!state || !state.process) {
    return res.status(400).json({ error: 'Không có tiến trình nào đang hoạt động để dừng.' });
  }

  state.logBuffer += `\n[Hệ thống] Đang yêu cầu dừng tiến trình theo lệnh người dùng...\n`;
  state.process.kill('SIGINT');
  
  res.json({ success: true, message: 'Đã gửi lệnh dừng tiến trình.' });
});

// 11. Endpoint lấy logs thời gian thực của User
app.get('/api/logs', requireAuth, (req, res) => {
  const username = req.username;
  const state = getProcessState(username);
  
  res.json({
    status: state.status,
    logs: state.logBuffer
  });
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`CMS Automation Server đang chạy tại http://localhost:${PORT}`);
  console.log(`====================================================`);
});
