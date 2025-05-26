// Ladda in miljövariabler 
require('dotenv').config(); // laddar .env

console.log('CORS_ORIGIN =', process.env.CORS_ORIGIN);
console.log('SMTP_USER  =', process.env.SMTP_USER);

// Importera nödvändiga moduler
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const fs = require('fs/promises');
const path = require('path');

console.log('===== DEBUG INFO =====');
console.log('Server startar i katalog:', __dirname);

const dataDir = path.join(__dirname, 'data');
console.log('Förväntad data-mapp:', dataDir);

// Kolla om data-mappen finns och visa dess innehåll
fs.readdir(dataDir)
  .then(files => {
    console.log('Filer i data-mappen:', files);
  })
  .catch(err => {
    console.error('Kunde inte läsa data-mappen:', err);
  });
console.log('======================');

// Applikationsinställningar
const app = express();
const port = process.env.PORT || 5000;
const uploadDir = path.join(__dirname, 'public', 'uploads');

// Lita på proxy (t.ex. Heroku, Nginx) för korrekt req.secure
app.set('trust proxy', 1);

// Endast om NODE_ENV=production: omdirigera HTTP → HTTPS
if (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true') {
  app.use((req, res, next) => {
    if (req.secure) return next();
    const redirectUrl = 'https://' + req.headers.host + req.originalUrl;
    return res.redirect(301, redirectUrl);
  });
}


// Säkerhetsheaders
app.use(helmet());

// CORS: endast din frontend
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    optionsSuccessStatus: 200
  })
);

// JSON-parser
app.use(express.json());

// Skapa nödvändiga kataloger
fs.mkdir(uploadDir, { recursive: true }).catch(console.error);
fs.mkdir(dataDir, { recursive: true }).catch(console.error);

// Statisk servering av uppladdade filer
app.use('/uploads', express.static(uploadDir));

// Multer-inställningar för bilduppladdning
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Endast bildfiler tillåtna.'), false);
  }
});

// Sökvärden för JSON-filer
const filePaths = {
  homeServices: path.join(dataDir, 'homeservices.json'),
  personal: path.join(dataDir, 'personal.json'),
  // services: path.join(dataDir, 'services.json'),
  projekt: path.join(dataDir, 'projekt.json'),
  kontakt: path.join(dataDir, 'kontakt.json'),
  admin: path.join(dataDir, 'adminpassword.json'),
};

// ==============================
// Rate Limiters
// ==============================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  message: { error: 'För många inloggningsförsök, försök igen om 15 min.' }
});
const emailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 3,
  message: { error: 'För många mailförsök, försök igen om en minut.' }
});

// ==============================
// GET-routes för att läsa data
// ==============================
['homeServices','personal','services','projekt','kontakt'].forEach((key) => {
  let route;
  if (key === 'homeServices') route = 'get-home-services';
  else if (key === 'personal') route = 'personal';
  else if (key === 'services') route = 'get-services';
  else if (key === 'projekt') route = 'get-projekt';
  else if (key === 'kontakt') route = 'get-kontakt';
  else route = key;

  app.get(`/api/${route}`, async (req, res) => {
    try {
      const data = await fs.readFile(filePaths[key], 'utf8');
      res.json(JSON.parse(data));
    } catch (err) {
      console.error(`Fel vid hämtning av ${key}:`, err);
      res.status(500).json({ error: `Fel vid hämtning av ${key}` });
    }
  });
});

// ==============================
// POST-routes för att spara data
// ==============================
['homeServices','personal','services','projekt'].forEach((key) => {
  const route = `save-${key}`;
  const prop = key;
  app.post(`/api/${route}`, async (req, res) => {
    const arr = req.body[prop];
    if (!Array.isArray(arr)) {
      return res.status(400).json({ error: `${prop} måste vara en array.` });
    }
    try {
      await fs.writeFile(filePaths[key], JSON.stringify(arr,null,2),'utf8');
      res.json({ success: true, message: `${prop} sparade!` });
    } catch (err) {
      console.error(`Fel vid sparande av ${key}:`, err);
      res.status(500).json({ error: `Fel vid sparande av ${prop}` });
    }
  });
});

// Kontakt (objekt)
app.post('/api/save-kontakt', async (req, res) => {
  const kontakt = req.body.kontakt;
  if (typeof kontakt !== 'object' || kontakt === null) {
    return res.status(400).json({ error: 'Kontakt måste vara ett objekt.' });
  }
  try {
    await fs.writeFile(filePaths.kontakt, JSON.stringify(kontakt,null,2),'utf8');
    res.json({ success: true, message: 'Kontaktinfo sparad!' });
  } catch (err) {
    console.error('Fel vid sparande av kontakt:', err);
    res.status(500).json({ error: 'Fel vid sparande av kontakt' });
  }
});

// ==============================
// Hälsokontroll
// ==============================
app.get('/', (req, res) => res.send('Servern är igång! ✅'));

// ==============================
// Bilduppladdning
// ==============================
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil mottagen.' });
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url });
});

// ==============================
// Skicka e-post
// ==============================
app.post(
  '/api/send-email',
  emailLimiter,
  [
    body('name').isString().trim().notEmpty(),
    body('email').isEmail(),
    body('subject').isString().trim().notEmpty(),
    body('message').isString().trim().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { name, email, subject, message } = req.body;
    try {
      const transporter = nodemailer.createTransport({
        service: process.env.MAIL_SERVICE || 'icloud',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      const mailOptions = {
        from: process.env.MAIL_FROM,
        to: process.env.MAIL_TO,
        subject: `Kontaktförfrågan: ${subject}`,
        text: `Namn: ${name}\nE-post: ${email}\n\nMeddelande:\n${message}`
      };
      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: 'E-post skickat!' });
    } catch (err) {
      console.error('Fel vid skickande av e-post:', err);
      res.status(500).json({ error: 'Misslyckades att skicka e-post.' });
    }
  }
);

// ==============================
// Admin-login
// ==============================
app.post(
  '/api/admin-login',
  loginLimiter,
  [ body('password').isString().isLength({ min: 3 }) ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { password } = req.body;
    try {
      const data = await fs.readFile(path.join(dataDir,'adminpassword.json'),'utf8');
      const { hash } = JSON.parse(data);
      const match = await bcrypt.compare(password, hash);
      if (match) return res.json({ success: true });
      res.status(401).json({ error: 'Fel lösenord' });
    } catch (err) {
      console.error('Fel vid inloggning:', err);
      res.status(500).json({ error: 'Internt serverfel' });
    }
  }
);

// ==============================
// Global felhanterare
// ==============================
app.use((err, req, res, next) => {
  console.error('Oväntat fel:', err);
  res.status(500).json({ error: 'Ett okänt fel inträffade på servern.' });
});

// Starta servern
app.listen(port, () => {
  console.log(`Servern körs på port ${port} i ${process.env.NODE_ENV || 'utvecklings'}-läge`);
});