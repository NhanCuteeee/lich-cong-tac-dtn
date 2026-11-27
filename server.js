const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// KIỂM TRA MÔI TRƯỜNG: CLOUD (TURSO) HOẶC OFFLINE (SQLITE CỤC BỘ)
// KIỂM TRA MÔI TRƯỜNG: CLOUD (TURSO) HOẶC OFFLINE (SQLITE CỤC BỘ)
const isCloud = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let db;
if (isCloud) {
    console.log("--> ĐANG KẾT NỐI DATABASE ĐÁM MÂY (TURSO CLOUD - LƯU TRỮ VĨNH VIỄN)...");
    const { createClient } = require('@libsql/client');
    
    // Giữ nguyên URL libsql:// gốc được cấp từ Turso
    const client = createClient({
        url: process.env.TURSO_DATABASE_URL.trim(),
        authToken: process.env.TURSO_AUTH_TOKEN.trim()
    });

    db = {
        all: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            client.execute({ sql, args: params || [] })
                .then(res => { if (typeof cb === 'function') cb(null, res.rows); })
                .catch(err => {
                    console.error("Lỗi db.all:", err.message);
                    if (typeof cb === 'function') cb(err);
                });
        },
        get: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            client.execute({ sql, args: params || [] })
                .then(res => { if (typeof cb === 'function') cb(null, res.rows[0] || null); })
                .catch(err => {
                    console.error("Lỗi db.get:", err.message);
                    if (typeof cb === 'function') cb(err);
                });
        },
        run: function(sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            client.execute({ sql, args: params || [] })
                .then(res => {
                    if (typeof cb === 'function') {
                        cb.call({ lastID: Number(res.lastInsertRowid || 0), changes: res.rowsAffected }, null);
                    }
                })
                .catch(err => {
                    console.error("Lỗi db.run:", err.message);
                    if (typeof cb === 'function') cb(err);
                });
        },
        prepare: (sql) => ({
            run: (...args) => {
                const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
                client.execute({ sql, args }).then(() => {
                    if (typeof cb === 'function') cb(null);
                }).catch(e => {
                    console.error("Lỗi prepare.run:", e.message);
                    if (typeof cb === 'function') cb(e);
                });
            },
            finalize: () => {}
        }),
        serialize: (fn) => { if (typeof fn === 'function') fn(); }
    };
} else {
    console.log("--> ĐANG CHẠY CƠ SỞ DỮ LIỆU CỤC BỘ TRÊN MÁY TÍNH (SQLITE)...");
    const sqlite3 = require('sqlite3').verbose();
    const dbFile = path.join(__dirname, 'youth_union.db');
    db = new sqlite3.Database(dbFile);
}
// KHỞI TẠO BẢNG CƠ SỞ DỮ LIỆU
function initDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendee_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        member_ids TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        department TEXT NOT NULL,
        title TEXT,
        can_approve INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        location TEXT NOT NULL,
        department TEXT NOT NULL,
        chairperson TEXT NOT NULL,
        chairperson_name TEXT,
        attendees TEXT,
        attendee_user_ids TEXT,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by_name TEXT,
        approved_by_name TEXT,
        reject_reason TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_name TEXT,
        schedule_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        meeting_date TEXT,
        meeting_time TEXT,
        meeting_location TEXT,
        role_in_meeting TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // DỮ LIỆU MẪU BAN ĐẦU
    db.get("SELECT COUNT(*) as count FROM departments", (err, row) => {
        if (!err && row && (row.count === 0 || row.count === '0')) {
            const depts = ['Thường trực Đoàn trường', 'Văn phòng Đoàn trường', 'Ban Tuyên giáo', 'Ban Phong trào', 'Ban Tổ chức - Kiểm tra'];
            depts.forEach(d => db.run(`INSERT OR IGNORE INTO departments (name) VALUES (?)`, [d]));
        }
    });

    db.get("SELECT COUNT(*) as count FROM titles", (err, row) => {
        if (!err && row && (row.count === 0 || row.count === '0')) {
            const defaultTitles = ['Bí thư Đoàn', 'Phó Bí thư Đoàn', 'Ủy viên Ban Thường vụ', 'Ủy viên Ban Chấp hành', 'Trưởng ban', 'Phó ban', 'Chánh Văn phòng Đoàn trường', 'Bí thư Chi đoàn', 'Cán bộ chuyên trách'];
            defaultTitles.forEach(t => db.run(`INSERT OR IGNORE INTO titles (name) VALUES (?)`, [t]));
        }
    });

    db.get("SELECT COUNT(*) as count FROM locations", (err, row) => {
        if (!err && row && (row.count === 0 || row.count === '0')) {
            const defaultLocs = ['Hội trường lớn (Tầng 1 - 200 chỗ)', 'Phòng họp Ban Thường vụ (Tầng 2 - 30 chỗ)', 'Phòng họp Trực tuyến (Zoom/Teams)', 'Văn phòng Đoàn trường cơ sở', 'Sân đa năng'];
            defaultLocs.forEach(l => db.run(`INSERT OR IGNORE INTO locations (name) VALUES (?)`, [l]));
        }
    });

    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (!err && row && (row.count === 0 || row.count === '0')) {
            const defaultUsers = [
                ['admin', '123456', 'Quản trị viên Hệ thống', 'admin', 'Văn phòng Đoàn trường', 'Quản trị viên', 1],
                ['bithu', '123456', 'Nguyễn Văn An', 'approver', 'Thường trực Đoàn trường', 'Bí thư Đoàn', 1],
                ['phobithu', '123456', 'Trần Thị Bình', 'approver', 'Thường trực Đoàn trường', 'Phó Bí thư Đoàn', 1],
                ['tuyengiao', '123456', 'Lê Hoàng Cường', 'staff', 'Ban Tuyên giáo', 'Trưởng ban', 0],
                ['phongtrao', '123456', 'Phạm Minh Đức', 'staff', 'Ban Phong trào', 'Phó ban', 0]
            ];
            defaultUsers.forEach(u => {
                db.run(`INSERT OR IGNORE INTO users (username, password, full_name, role, department, title, can_approve) VALUES (?, ?, ?, ?, ?, ?, ?)`, u);
            });
        }
    });
}

initDatabase();

// APIs
app.get('/api/locations', (req, res) => {
    db.all("SELECT * FROM locations ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Lỗi tải danh sách địa điểm' });
        res.json(rows);
    });
});

app.post('/api/locations', (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tên địa điểm không được để trống' });
    db.run("INSERT INTO locations (name) VALUES (?)", [name.trim()], function(err) {
        if (err) return res.status(400).json({ error: 'Địa điểm này đã tồn tại!' });
        res.json({ success: true, id: this.lastID, name: name.trim() });
    });
});

app.delete('/api/locations/:id', (req, res) => {
    db.run("DELETE FROM locations WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Lỗi xóa địa điểm' });
        res.json({ success: true });
    });
});

app.get('/api/groups', (req, res) => {
    db.all("SELECT * FROM attendee_groups ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Lỗi tải danh sách nhóm' });
        res.json(rows);
    });
});

app.post('/api/groups', (req, res) => {
    const { name, member_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tên nhóm không được để trống' });
    db.run("INSERT INTO attendee_groups (name, member_ids) VALUES (?, ?)", [name.trim(), member_ids || ''], function(err) {
        if (err) return res.status(400).json({ error: 'Tên nhóm này đã tồn tại!' });
        res.json({ success: true, id: this.lastID });
    });
});

app.put('/api/groups/:id', (req, res) => {
    const { id } = req.params;
    const { name, member_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tên nhóm không được để trống' });

    db.run("UPDATE attendee_groups SET name = ?, member_ids = ? WHERE id = ?", [name.trim(), member_ids || '', id], function(err) {
        if (err) return res.status(500).json({ error: 'Lỗi cập nhật nhóm' });
        res.json({ success: true, changes: this.changes });
    });
});

app.delete('/api/groups/:id', (req, res) => {
    db.run("DELETE FROM attendee_groups WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Lỗi xóa nhóm' });
        res.json({ success: true });
    });
});

app.get('/api/departments', (req, res) => {
    db.all("SELECT * FROM departments ORDER BY id ASC", [], (err, rows) => res.json(rows));
});
app.post('/api/departments', (req, res) => {
    const { name } = req.body;
    db.run("INSERT INTO departments (name) VALUES (?)", [name.trim()], function(err) {
        if (err) return res.status(400).json({ error: 'Ban này đã tồn tại!' });
        res.json({ success: true, id: this.lastID });
    });
});
app.delete('/api/departments/:id', (req, res) => {
    db.run("DELETE FROM departments WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

app.get('/api/titles', (req, res) => {
    db.all("SELECT * FROM titles ORDER BY id ASC", [], (err, rows) => res.json(rows));
});
app.post('/api/titles', (req, res) => {
    const { name } = req.body;
    db.run("INSERT INTO titles (name) VALUES (?)", [name.trim()], function(err) {
        if (err) return res.status(400).json({ error: 'Chức vụ này đã tồn tại!' });
        res.json({ success: true, id: this.lastID });
    });
});
app.delete('/api/titles/:id', (req, res) => {
    db.run("DELETE FROM titles WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

// AUTH LOGIN
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT id, username, full_name, role, department, title, can_approve FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) return res.status(500).json({ error: 'Lỗi máy chủ' });
        if (!row) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
        res.json({ success: true, user: row });
    });
});

// USER SELF CHANGE PASSWORD
app.post('/api/users/change-password', (req, res) => {
    const { user_id, current_password, new_password } = req.body;
    if (!user_id || !current_password || !new_password) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới' });
    }
    db.get('SELECT id FROM users WHERE id = ? AND password = ?', [user_id, current_password], (err, row) => {
        if (err) return res.status(500).json({ error: 'Lỗi hệ thống' });
        if (!row) return res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác!' });

        db.run('UPDATE users SET password = ? WHERE id = ?', [new_password, user_id], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: 'Lỗi cập nhật mật khẩu' });
            res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
        });
    });
});

// ADMIN RESET PASSWORD TO DEFAULT 123456
app.post('/api/users/:id/reset-password', (req, res) => {
    const { id } = req.params;
    db.run('UPDATE users SET password = "123456" WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: 'Lỗi đặt lại mật khẩu' });
        res.json({ success: true, message: 'Đã đặt lại mật khẩu về mặc định 123456!' });
    });
});

// ADMIN UPDATE USER
app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { full_name, title, department, role, can_approve } = req.body;

    if (!full_name || !department) {
        return res.status(400).json({ error: 'Họ tên và ban không được để trống' });
    }

    const query = `UPDATE users SET full_name = ?, title = ?, department = ?, role = ?, can_approve = ? WHERE id = ?`;
    db.run(query, [full_name.trim(), title || 'Cán bộ', department, role || 'staff', can_approve ? 1 : 0, id], function(err) {
        if (err) return res.status(500).json({ error: 'Lỗi cập nhật tài khoản' });
        res.json({ success: true });
    });
});

// SCHEDULES & PUBLIC
app.get('/api/schedules/public', (req, res) => {
    const { department } = req.query;
    let query = "SELECT * FROM schedules WHERE status = 'approved'";
    const params = [];
    if (department && department !== 'all') {
        query += " AND department = ?";
        params.push(department);
    }
    query += " ORDER BY date ASC, start_time ASC";
    db.all(query, params, (err, rows) => res.json(rows));
});

app.get('/api/schedules', (req, res) => {
    db.all("SELECT * FROM schedules ORDER BY date ASC, start_time ASC", [], (err, rows) => res.json(rows));
});

function extractPersonName(chairpersonText, rawName) {
    if (rawName && rawName.trim()) return rawName.trim();
    if (!chairpersonText) return '';
    let clean = chairpersonText.replace(/^Đ\/c\s+/i, '');
    let parts = clean.split('-');
    return parts[0].trim();
}

function findLeaderConflicts(date, startTime, endTime, leaderName, excludeScheduleId, callback) {
    if (!leaderName) return callback(null, null);

    const query = `SELECT * FROM schedules 
        WHERE date = ? AND status = 'approved' AND id != ?
        AND ((start_time < ? AND end_time > ?) OR (start_time >= ? AND start_time < ?))`;

    db.all(query, [date, excludeScheduleId || 0, endTime, startTime, startTime, endTime], (err, rows) => {
        if (err) return callback(err, null);
        if (!rows || rows.length === 0) return callback(null, null);

        const cleanLeader = leaderName.toLowerCase().trim();

        for (const row of rows) {
            const rowChairperson = (row.chairperson_name || row.chairperson || '').toLowerCase();
            const rowAttendees = (row.attendees || '').toLowerCase();

            if (rowChairperson.includes(cleanLeader)) {
                return callback(null, {
                    type: 'as_chairperson',
                    conflictSchedule: row,
                    message: `Đ/c ${leaderName} đang bận CHỦ TRÌ cuộc họp "${row.title}" (${row.start_time} - ${row.end_time}) tại "${row.location}"!`
                });
            }

            if (rowAttendees.includes(cleanLeader)) {
                return callback(null, {
                    type: 'as_attendee',
                    conflictSchedule: row,
                    message: `Đ/c ${leaderName} đang bận THAM DỰ cuộc họp "${row.title}" (${row.start_time} - ${row.end_time}) tại "${row.location}"!`
                });
            }
        }

        return callback(null, null);
    });
}

function notifyParticipantsOnApprove(schedule) {
    const { id, title, date, start_time, end_time, location, chairperson, chairperson_name, attendees } = schedule;
    const leaderName = extractPersonName(chairperson, chairperson_name);

    db.all("SELECT id, full_name FROM users WHERE username != 'admin'", [], (err, users) => {
        if (err || !users) return;

        users.forEach(u => {
            const uName = u.full_name.toLowerCase().trim();

            if (leaderName && leaderName.toLowerCase().trim() === uName) {
                const msg = `Lịch công tác "${title}" do bạn CHỦ TRÌ vào lúc ${start_time} - ${end_time} (${date}) tại "${location}" đã được phê duyệt ban hành!`;
                db.run(`INSERT INTO notifications (user_id, user_name, schedule_id, title, message, meeting_date, meeting_time, meeting_location, role_in_meeting)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [u.id, u.full_name, id, title, msg, date, `${start_time} - ${end_time}`, location, 'chairperson']);
            } 
            else if (attendees && attendees.toLowerCase().includes(uName)) {
                const msg = `Bạn được triệu tập THAM DỰ cuộc họp "${title}" vào lúc ${start_time} - ${end_time} (${date}) tại "${location}". Chủ trì: ${chairperson}.`;
                db.run(`INSERT INTO notifications (user_id, user_name, schedule_id, title, message, meeting_date, meeting_time, meeting_location, role_in_meeting)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [u.id, u.full_name, id, title, msg, date, `${start_time} - ${end_time}`, location, 'attendee']);
            }
        });
    });
}

// NOTIFICATIONS API
app.get('/api/notifications', (req, res) => {
    const { user_id, user_name } = req.query;
    if (!user_id && !user_name) return res.json([]);

    let query = "SELECT * FROM notifications WHERE (user_id = ? OR user_name = ?) ORDER BY id DESC LIMIT 50";
    db.all(query, [user_id || 0, user_name || ''], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Lỗi tải thông báo' });
        res.json(rows || []);
    });
});

app.patch('/api/notifications/mark-read', (req, res) => {
    const { user_id } = req.body;
    db.run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [user_id], () => {
        res.json({ success: true });
    });
});

// CREATE SCHEDULE
app.post('/api/schedules', (req, res) => {
    const { 
        title, date, start_time, end_time, location, department, 
        chairperson, chairperson_name, attendees, attendee_user_ids, 
        note, created_by_name, role, can_approve 
    } = req.body;

    if (!title || !date || !start_time || !end_time || !location || !department || !chairperson) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ các thông tin bắt buộc' });
    }

    const meetingStart = new Date(`${date}T${start_time}:00`);
    const now = new Date();
    if (meetingStart < now) {
        return res.status(400).json({ error: 'Thời gian bắt đầu cuộc họp không được trước thời gian hiện tại!' });
    }

    if (end_time <= start_time) {
        return res.status(400).json({ error: 'Giờ kết thúc phải sau giờ bắt đầu!' });
    }

    const leaderName = extractPersonName(chairperson, chairperson_name);

    const roomConflictQuery = `SELECT * FROM schedules 
        WHERE date = ? AND location = ? AND status = 'approved'
        AND ((start_time < ? AND end_time > ?) OR (start_time >= ? AND start_time < ?))`;

    db.get(roomConflictQuery, [date, location, end_time, start_time, start_time, end_time], (roomErr, roomConflict) => {
        if (roomErr) return res.status(500).json({ error: 'Lỗi kiểm tra phòng' });
        if (roomConflict) {
            return res.status(409).json({ 
                error: `Trùng phòng họp! Đã có cuộc họp "${roomConflict.title}" được duyệt tại "${location}" từ ${roomConflict.start_time} đến ${roomConflict.end_time}.` 
            });
        }

        findLeaderConflicts(date, start_time, end_time, leaderName, 0, (leaderErr, leaderConflict) => {
            if (leaderErr) return res.status(500).json({ error: 'Lỗi kiểm tra lịch người chủ trì' });
            if (leaderConflict) {
                return res.status(409).json({
                    error: `Trùng lịch người chủ trì! ${leaderConflict.message} Vui lòng chỉnh sửa lại thời gian hoặc chọn người chủ trì khác.`
                });
            }

            const status = (role === 'approver' || role === 'admin') && can_approve ? 'approved' : 'pending';
            const approvedBy = status === 'approved' ? created_by_name : null;

            const insertQuery = `INSERT INTO schedules 
                (title, date, start_time, end_time, location, department, chairperson, chairperson_name, attendees, attendee_user_ids, note, status, created_by_name, approved_by_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            db.run(insertQuery, [
                title, date, start_time, end_time, location, department, 
                chairperson, leaderName, attendees || '', attendee_user_ids || '', 
                note || '', status, created_by_name || 'Cán bộ', approvedBy
            ], function(insertErr) {
                if (insertErr) return res.status(500).json({ error: 'Lỗi lưu cuộc họp' });
                
                const newId = this.lastID;
                if (status === 'approved') {
                    notifyParticipantsOnApprove({
                        id: newId, title, date, start_time, end_time, location, chairperson, chairperson_name, attendees
                    });
                }
                res.json({ success: true, id: newId, status });
            });
        });
    });
});

app.get('/api/schedules/:id/check-conflict', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM schedules WHERE id = ?', [id], (err, sched) => {
        if (err || !sched) return res.status(404).json({ error: 'Không tìm thấy lịch' });

        const leaderName = extractPersonName(sched.chairperson, sched.chairperson_name);

        const roomQuery = `SELECT * FROM schedules 
            WHERE date = ? AND location = ? AND status = 'approved' AND id != ?
            AND ((start_time < ? AND end_time > ?) OR (start_time >= ? AND start_time < ?))`;

        db.get(roomQuery, [sched.date, sched.location, sched.id, sched.end_time, sched.start_time, sched.start_time, sched.end_time], (err2, roomConflict) => {
            if (roomConflict) {
                return res.json({
                    hasConflict: true,
                    type: 'room',
                    conflict: roomConflict,
                    message: `Trùng địa điểm! "${sched.location}" đã có cuộc họp "${roomConflict.title}" (${roomConflict.start_time} - ${roomConflict.end_time}).`
                });
            }

            findLeaderConflicts(sched.date, sched.start_time, sched.end_time, leaderName, sched.id, (err3, leaderConflict) => {
                if (leaderConflict) {
                    return res.json({
                        hasConflict: true,
                        type: leaderConflict.type,
                        conflict: leaderConflict.conflictSchedule,
                        message: leaderConflict.message
                    });
                }

                return res.json({ hasConflict: false });
            });
        });
    });
});

app.patch('/api/schedules/:id', (req, res) => {
    const { status, approved_by_name, reject_reason } = req.body;
    const { id } = req.params;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }

    if (status === 'approved') {
        db.get('SELECT * FROM schedules WHERE id = ?', [id], (err, sched) => {
            if (err || !sched) return res.status(404).json({ error: 'Không tìm thấy cuộc họp' });

            const leaderName = extractPersonName(sched.chairperson, sched.chairperson_name);

            findLeaderConflicts(sched.date, sched.start_time, sched.end_time, leaderName, sched.id, (lErr, lConflict) => {
                if (lConflict) {
                    return res.status(409).json({
                        error: `Không thể duyệt do trùng lịch người chủ trì! ${lConflict.message} Yêu cầu ban đăng ký chỉnh sửa thời gian hoặc đổi người chủ trì.`
                    });
                }

                const query = `UPDATE schedules SET status = ?, approved_by_name = ?, reject_reason = ? WHERE id = ?`;
                db.run(query, [status, approved_by_name || 'Bí thư', reject_reason || '', id], function(uErr) {
                    if (uErr) return res.status(500).json({ error: 'Lỗi cập nhật lịch' });

                    notifyParticipantsOnApprove({
                        id: sched.id,
                        title: sched.title,
                        date: sched.date,
                        start_time: sched.start_time,
                        end_time: sched.end_time,
                        location: sched.location,
                        chairperson: sched.chairperson,
                        chairperson_name: sched.chairperson_name,
                        attendees: sched.attendees,
                        created_by_name: sched.created_by_name,
                        approved_by_name: approved_by_name || 'Bí thư'
                    });

                    res.json({ success: true, changes: this.changes });
                });
            });
        });
    } else {
        const query = `UPDATE schedules SET status = ?, approved_by_name = ?, reject_reason = ? WHERE id = ?`;
        db.run(query, [status, approved_by_name || null, reject_reason || '', id], function(err) {
            if (err) return res.status(500).json({ error: 'Lỗi cập nhật lịch' });

            db.get("SELECT * FROM schedules WHERE id = ?", [id], (sErr, sRow) => {
                if (!sErr && sRow && sRow.created_by_name) {
                    db.get("SELECT id FROM users WHERE full_name = ?", [sRow.created_by_name], (uErr, uRow) => {
                        if (uRow) {
                            db.run(`INSERT INTO notifications (user_id, user_name, schedule_id, title, message, meeting_date, meeting_time, meeting_location, role_in_meeting)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creator')`,
                                [uRow.id, sRow.created_by_name, sRow.id, sRow.title, `Lịch cuộc họp "${sRow.title}" bị YÊU CẦU CHỈNH SỬA bởi ${approved_by_name || 'Bí thư'}. Lý do: ${reject_reason || 'Không có'}`, sRow.date, `${sRow.start_time} - ${sRow.end_time}`, sRow.location]);
                        }
                    });
                }
            });

            res.json({ success: true, changes: this.changes });
        });
    }
});

app.delete('/api/schedules/:id', (req, res) => {
    db.run('DELETE FROM schedules WHERE id = ?', [req.params.id], () => res.json({ success: true }));
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, username, full_name, role, department, title, can_approve FROM users ORDER BY id ASC", [], (err, rows) => res.json(rows));
});

app.post('/api/users', (req, res) => {
    const { username, password, full_name, role, department, title, can_approve } = req.body;
    if (!username || !password || !full_name) {
        return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập, mật khẩu và họ tên' });
    }
    const query = `INSERT INTO users (username, password, full_name, role, department, title, can_approve) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [username, password, full_name, role || 'staff', department || 'Văn phòng Đoàn trường', title || '', can_approve ? 1 : 0], function(err) {
        if (err) return res.status(400).json({ error: 'Tên tài khoản này đã tồn tại!' });
        res.json({ success: true, id: this.lastID });
    });
});

app.patch('/api/users/:id/toggle-approve', (req, res) => {
    db.run('UPDATE users SET can_approve = ? WHERE id = ?', [req.body.can_approve ? 1 : 0, req.params.id], () => res.json({ success: true }));
});

app.delete('/api/users/:id', (req, res) => {
    db.run('DELETE FROM users WHERE id = ? AND username != "admin"', [req.params.id], () => res.json({ success: true }));
});

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

app.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`=======================================================`);
    console.log(` HỆ THỐNG QUẢN LÝ LỊCH HỌP ĐOÀN THANH NIÊN ĐANG CHẠY!`);
    console.log(`=======================================================`);
    console.log(`* Trên máy chủ này:        http://localhost:${PORT}`);
    console.log(`* Máy khác trong mạng LAN: http://${localIp}:${PORT}`);
    console.log(`-------------------------------------------------------`);
    console.log(`Truy cập bằng HTTP:        http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
