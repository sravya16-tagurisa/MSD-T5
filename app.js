
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const BOOKS_FILE = path.join(__dirname, 'books.json');
const SAMPLE_BOOKS = [
  { id: 1, title: 'Atomic Habits', author: 'James Clear', available: true },
  { id: 2, title: 'Deep Work', author: 'Cal Newport', available: false }
];

const app = express();
app.use(express.json());

// Simple in-memory write queue (mutex) to serialize file writes
let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  // append to queue, ensure sequential writes
  writeQueue = writeQueue.then(() => fn()).catch(() => fn());
  return writeQueue;
}

// Read books.json (create with sample if missing)
async function readBooksFile() {
  try {
    const raw = await fs.readFile(BOOKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // create with sample content
      await writeBooksFile(SAMPLE_BOOKS);
      // return a copy
      return SAMPLE_BOOKS.map(b => ({ ...b }));
    }
    // If JSON parse error or other fs error -> throw up
    throw err;
  }
}

// Atomic-ish write: write to tmp then rename
async function writeBooksFile(books) {
  return enqueueWrite(async () => {
    const tmp = BOOKS_FILE + '.tmp';
    const data = JSON.stringify(books, null, 2);
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, BOOKS_FILE);
  });
}

// Root route so browser visiting / doesn't get "Cannot GET /"
app.get('/', (req, res) => {
  res.send(`
    <h1>Books API</h1>
    <p>Available endpoints:</p>
    <ul>
      <li>GET /books</li>
      <li>GET /books/available</li>
      <li>POST /books</li>
      <li>PUT /books/:id</li>
      <li>DELETE /books/:id</li>
    </ul>
    <p>Use <code>Content-Type: application/json</code> for POST/PUT bodies.</p>
  `);
});

// GET /books -> all books
app.get('/books', async (req, res, next) => {
  try {
    const books = await readBooksFile();
    res.json(books);
  } catch (err) {
    next(err);
  }
});

// GET /books/available -> bonus endpoint
app.get('/books/available', async (req, res, next) => {
  try {
    const books = await readBooksFile();
    res.json(books.filter(b => b.available === true));
  } catch (err) {
    next(err);
  }
});

// POST /books -> add new book with auto-increment id
app.post('/books', async (req, res, next) => {
  try {
    const { title, author, available } = req.body;
    if (!title || !author) {
      return res.status(400).json({ error: 'title and author are required' });
    }

    const books = await readBooksFile();
    const maxId = books.reduce((m, b) => Math.max(m, b.id || 0), 0);
    const newBook = {
      id: maxId + 1,
      title,
      author,
      available: typeof available === 'boolean' ? available : true
    };

    books.push(newBook);
    await writeBooksFile(books);
    res.status(201).json(newBook);
  } catch (err) {
    next(err);
  }
});

// PUT /books/:id -> update title, author, or available
app.put('/books/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const { title, author, available } = req.body;
    if (title === undefined && author === undefined && available === undefined) {
      return res.status(400).json({ error: 'Provide at least one of title, author, available' });
    }

    const books = await readBooksFile();
    const idx = books.findIndex(b => b.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Book not found' });

    const book = books[idx];
    if (title !== undefined) book.title = title;
    if (author !== undefined) book.author = author;
    if (available !== undefined) book.available = Boolean(available);

    books[idx] = book;
    await writeBooksFile(books);

    res.json(book);
  } catch (err) {
    next(err);
  }
});

// DELETE /books/:id -> delete book
app.delete('/books/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const books = await readBooksFile();
    const idx = books.findIndex(b => b.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Book not found' });

    const removed = books.splice(idx, 1)[0];
    await writeBooksFile(books);

    res.json({ message: 'Deleted', book: removed });
  } catch (err) {
    next(err);
  }
});

// 404 for other routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// centralized error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (err && err.code === 'ENOENT') {
    return res.status(500).json({ error: 'Books file missing and could not be created' });
  }
  // If JSON parse error (invalid JSON in file) give helpful message
  if (err && err.name === 'SyntaxError') {
    return res.status(500).json({ error: 'Books file contains invalid JSON' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;