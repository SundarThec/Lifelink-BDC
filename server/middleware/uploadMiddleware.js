const path = require('path');
const fs = require('fs');
const multer = require('multer');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
const DOCUMENT_DIR = path.join(__dirname, '..', '..', 'uploads', 'documents');

// Ensure directories exist
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}
if (!fs.existsSync(DOCUMENT_DIR)) {
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
}

// Storage for profile avatars
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, AVATAR_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `avatar_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, uniqueName);
  }
});

// Storage for confidential medical documents
const documentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, DOCUMENT_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueName = `doc_${Date.now()}_${sanitizedBase}${ext}`;
    cb(null, uniqueName);
  }
});

// Avatar filter: images only
const avatarFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image file. Only JPG, PNG, and WebP images are allowed.'), false);
  }
};

// Document filter: PDF and medical images
const documentFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid document format. Only PDF, JPG, and PNG files are allowed.'), false);
  }
};

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: avatarFilter,
  limits: { fileSize: 3 * 1024 * 1024 } // 3MB
});

const uploadDocuments = multer({
  storage: documentStorage,
  fileFilter: documentFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
});

module.exports = {
  uploadAvatar,
  uploadDocuments,
  AVATAR_DIR,
  DOCUMENT_DIR
};
