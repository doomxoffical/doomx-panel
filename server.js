const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DB_FILE = path.join(__dirname, 'keys.json');
const ADMIN_PASS = "DOOMX123"; // Apne hisaab se Admin Password badlein

// Database Helper
function getDB() {
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// -------------------------------------------------------------------------
// 1. MOD APP API: Key & HWID Verification Endpoint
// -------------------------------------------------------------------------
app.post('/api/verify', (req, res) => {
    const key = (req.body.key || '').trim();
    const hwid = (req.body.hwid || '').trim();

    if (!key || !hwid) {
        return res.json({ status: 'error', message: 'Key or HWID missing' });
    }

    const db = getDB();
    if (!db[key]) {
        return res.json({ status: 'error', message: 'Invalid License Key!' });
    }

    const item = db[key];
    const now = Math.floor(Date.now() / 1000);

    // First time use -> Bind HWID & Set Expiry
    if (item.status === 'unused') {
        item.status = 'active';
        item.hwid = hwid;
        item.activated_at = now;
        item.expires_at = item.duration_days > 0 ? now + (item.duration_days * 86400) : 0;
        saveDB(db);
    }

    // HWID Binding Check
    if (item.hwid !== hwid) {
        return res.json({ status: 'error', message: 'Key bound to another device!' });
    }

    // Expiry Check
    if (item.expires_at > 0 && now > item.expires_at) {
        item.status = 'expired';
        saveDB(db);
        return res.json({ status: 'error', message: 'License Key Expired!' });
    }

    const expStr = item.expires_at > 0 ? new Date(item.expires_at * 1000).toISOString().replace('T', ' ').substring(0, 16) : 'Lifetime';

    return res.json({
        status: 'success',
        message: 'Login Successful',
        expires_at: expStr
    });
});

// -------------------------------------------------------------------------
// 2. ADMIN PANEL UI & CONTROLLER
// -------------------------------------------------------------------------
app.get('/', (req, res) => {
    const db = getDB();
    const keysList = Object.values(db).reverse();

    let rowsHtml = keysList.map(k => `
        <tr>
            <td><b style="color:#fff;">${k.key}</b></td>
            <td>${k.duration_days === 0 ? 'Lifetime' : k.duration_days + ' Days'}</td>
            <td><span class="badge ${k.status}">${k.status.toUpperCase()}</span></td>
            <td><code>${k.hwid || 'Not Registered'}</code></td>
            <td>${k.expires_at > 0 ? new Date(k.expires_at * 1000).toLocaleString() : (k.status === 'active' ? 'Lifetime' : 'N/A')}</td>
            <td>${k.hwid ? `<a href="/reset?key=${encodeURIComponent(k.key)}"><button class="btn-reset">Reset HWID</button></a>` : '-'}</td>
        </tr>
    `).join('');

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>DOOM X Key Manager</title>
        <style>
            body { background:#0a0a0f; color:#e1e1e8; font-family:'Segoe UI', sans-serif; padding:20px; }
            .container { max-width:950px; margin:0 auto; }
            h1 { color:#dc143c; border-bottom:2px solid #dc143c; padding-bottom:10px; }
            .panel { background:#14141d; border:1px solid #282835; border-radius:10px; padding:20px; margin-bottom:20px; }
            select, input, button { padding:10px 15px; background:#1e1e28; border:1px solid #3d3d4e; color:#fff; border-radius:6px; font-size:14px; }
            button.btn-gen { background:#dc143c; font-weight:bold; cursor:pointer; border:none; }
            button.btn-reset { background:#ff8c00; border:none; padding:5px 10px; font-size:12px; cursor:pointer; border-radius:4px; color:#fff; }
            table { width:100%; border-collapse:collapse; margin-top:15px; }
            th, td { padding:12px; text-align:left; border-bottom:1px solid #222230; font-size:14px; }
            th { background:#1a1a24; color:#dc143c; }
            .badge { padding:4px 8px; border-radius:4px; font-size:12px; font-weight:bold; }
            .unused { background:#1b3820; color:#00ff7f; }
            .active { background:#382d1b; color:#ffa500; }
            .expired { background:#381b1b; color:#ff4500; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>DOOM X KEY MANAGER PANEL</h1>
            <div class="panel">
                <h3>Generate New License Keys</h3>
                <form action="/generate" method="POST" style="display:flex; gap:15px; align-items:center;">
                    <label>Duration:</label>
                    <select name="duration">
                        <option value="1">1 Day</option>
                        <option value="3">3 Days</option>
                        <option value="7" selected>7 Days</option>
                        <option value="30">30 Days</option>
                        <option value="0">Lifetime</option>
                    </select>
                    <label>Quantity:</label>
                    <input type="number" name="count" value="1" min="1" max="100" style="width:80px;">
                    <button type="submit" class="btn-gen">GENERATE KEYS</button>
                </form>
            </div>
            <div class="panel">
                <h3>Generated License Keys (${keysList.length})</h3>
                <table>
                    <thead>
                        <tr>
                            <th>License Key</th>
                            <th>Duration</th>
                            <th>Status</th>
                            <th>Device ID (HWID)</th>
                            <th>Expires At</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
    </body>
    </html>
    `);
});

app.post('/generate', (req, res) => {
    const days = parseInt(req.body.duration) || 0;
    const count = parseInt(req.body.count) || 1;
    const db = getDB();

    const durCode = days === 1 ? '1D' : days === 3 ? '3D' : days === 7 ? '7D' : days === 30 ? '30D' : 'LIF';

    for (let i = 0; i < count; i++) {
        const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
        const key = `DMX-${durCode}-${rand}`;
        db[key] = {
            key,
            duration_days: days,
            hwid: '',
            status: 'unused',
            activated_at: 0,
            expires_at: 0
        };
    }

    saveDB(db);
    res.redirect('/');
});

app.get('/reset', (req, res) => {
    const key = req.query.key;
    const db = getDB();
    if (db[key]) {
        db[key].hwid = '';
        db[key].status = 'unused';
        db[key].expires_at = 0;
        saveDB(db);
    }
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DOOM X Panel running on port ${PORT}`));
