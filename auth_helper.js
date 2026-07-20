import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, './data');
const USERS_DIR = path.resolve(DATA_DIR, 'users');

// Đảm bảo thư mục dữ liệu tồn tại
export async function ensureDataDirs() {
  try {
    await fs.mkdir(USERS_DIR, { recursive: true });
  } catch (err) {
    console.error('Không thể tạo thư mục dữ liệu người dùng:', err);
  }
}

// Băm mật khẩu sử dụng PBKDF2
export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

// Tạo salt ngẫu nhiên
export function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

// Đăng ký người dùng mới
export async function registerUser(username, password) {
  await ensureDataDirs();
  const sanitizedUsername = username.trim().toLowerCase();
  
  // Kiểm tra tính hợp lệ của username (chỉ cho phép chữ cái, số, gạch dưới)
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(sanitizedUsername)) {
    throw new Error('Tên đăng nhập không hợp lệ (3-20 ký tự, chỉ chứa chữ thường, chữ hoa, số và gạch dưới).');
  }

  if (password.length < 6) {
    throw new Error('Mật khẩu phải từ 6 ký tự trở lên.');
  }

  const userFolder = path.join(USERS_DIR, sanitizedUsername);
  const profilePath = path.join(userFolder, 'profile.json');

  if (existsSync(profilePath)) {
    throw new Error('Tên đăng nhập đã tồn tại trên hệ thống.');
  }

  // Tạo thư mục của user
  await fs.mkdir(userFolder, { recursive: true });

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);

  const profile = {
    username: sanitizedUsername,
    passwordHash,
    salt,
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

  // Tạo cấu hình mặc định trống cho user
  const configPath = path.join(userFolder, 'config.json');
  const defaultConfig = {
    URL_LOGIN: '',
    URL_CREATE: '',
    USERNAME: '',
    PASSWORD: '',
    Tacgia: sanitizedUsername,
    Danhmuc: 'Tin tức',
    GEMINI_API_KEY: '',
    URL_LOGIN_2: '',
    URL_CREATE_2: '',
    EMAIL_SENDER: '',
    EMAIL_PASSWORD: '',
    EMAIL_RECEIVER: ''
  };
  await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');

  // Tạo file data_CMS.json mặc định trống
  const dataCmsPath = path.join(userFolder, 'data_CMS.json');
  await fs.writeFile(dataCmsPath, '[]', 'utf-8');

  // Đảm bảo tạo các thư mục Vanban_CMS/{username} và Luu_CMS/{username}
  const userUploads = path.resolve(__dirname, `../Vanban_CMS/${sanitizedUsername}`);
  const userArchive = path.resolve(__dirname, `../Luu_CMS/${sanitizedUsername}`);
  await fs.mkdir(userUploads, { recursive: true }).catch(() => {});
  await fs.mkdir(userArchive, { recursive: true }).catch(() => {});

  return { username: sanitizedUsername };
}

// Đăng nhập
export async function authenticateUser(username, password) {
  const sanitizedUsername = username.trim().toLowerCase();
  const userFolder = path.join(USERS_DIR, sanitizedUsername);
  const profilePath = path.join(userFolder, 'profile.json');

  if (!existsSync(profilePath)) {
    throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
  }

  try {
    const data = await fs.readFile(profilePath, 'utf-8');
    const profile = JSON.parse(data);
    const calculatedHash = hashPassword(password, profile.salt);
    
    if (calculatedHash !== profile.passwordHash) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    return { username: profile.username };
  } catch (err) {
    if (err.message.includes('không chính xác')) {
      throw err;
    }
    throw new Error('Lỗi hệ thống khi xác thực tài khoản.');
  }
}
