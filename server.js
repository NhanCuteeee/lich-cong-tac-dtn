const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= KẾT NỐI DATABASE (TURSO HOẶC SQLITE CỤC BỘ) =================
const isCloud = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let db;
if (isCloud) {
    console.log("--> ĐANG KẾT NỐI DATABASE ĐÁM MÂY (TURSO CLOUD - LƯU TRỮ VĨNH VIỄN)...");
    const { createClient } = require('@libsql/client');
    
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

// ================= KHỞI TẠO CẤU TRÚC BẢNG =================
function initDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        full_name TEXT,
        title TEXT,
        department TEXT,
        role TEXT DEFAULT 'staff',
        can_approve INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendee_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        member_ids TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        location TEXT,
        department TEXT,
        chairperson TEXT,
        chairperson_name TEXT,
        attendees TEXT,
        note TEXT,
        status TEXT DEFAULT 'pending',
        created_by_name TEXT,
        approved_by_name TEXT,
        reject_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        schedule_id INTEGER,
        message TEXT,
        meeting_date TEXT,
        meeting_time TEXT,
        meeting_location TEXT,
        role_in_meeting TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tạo tài khoản admin mặc định nếu chưa tồn tại
    db.get('SELECT COUNT(*) as count FROM users WHERE username = "admin"', (err, row) => {
        if (!err && (!row || row.count === 0)) {
            db.run(`INSERT INTO users (username, password, full_name, title, department, role, can_approve)
                    VALUES ('admin', '123456', 'Quản trị viên Hệ thống', 'Quản trị viên', 'Văn phòng Đoàn trường', 'admin', 1)`);
            console.log("--> Đã tạo tài khoản quản trị mặc định: admin / 123456");
        }
    });

    // Thêm các ban chuyên môn mẫu nếu trống
    db.get('SELECT COUNT(*) as count FROM departments', (err, row) => {
        if (!err && (!row || row.count === 0)) {
            const depts = ['Thường trực Đoàn trường', 'Văn phòng Đoàn trường', 'Ban Tuyên giáo', 'Ban Phong trào', 'Ban Tổ chức - Kiểm tra'];
            depts.forEach(d => db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', [d]));
        }
    });

    // Thêm chức vụ mẫu nếu trống
    db.get('SELECT COUNT(*) as count FROM titles', (err, row) => {
        if (!err && (!row || row.count === 0)) {
            const titles = ['Bí thư Đoàn', 'Phó Bí thư Đoàn', 'Ủy viên Ban Thường vụ', 'Ủy viên Ban Chấp hành', 'Trưởng ban', 'Phó ban', 'Cán bộ'];
            titles.forEach(t => db.run('INSERT OR IGNORE INTO titles (name) VALUES (?)', [t]));
        }
    });

    // Thêm phòng họp mẫu nếu trống
    db.get('SELECT COUNT(*) as count FROM locations', (err, row) => {
        if (!err && (!row || row.count === 0)) {
            const locs = ['Văn phòng Đoàn trường', 'Hội trường Lớn', 'Phòng họp số 1', 'Phòng họp số 2', 'Sân đa năng'];
            locs.forEach(l => db.run('INSERT OR IGNORE INTO locations (name) VALUES (?)', [l]));
        }
    });
}

initDatabase();

// ================= API XÁC THỰC & ĐĂNG NHẬP =================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu' });

    db.get('SELECT id, username, full_name, title, department, role, can_approve FROM users WHERE username = ? AND password = ?', [username.trim(), password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
        res.json({ success: true, user });
    });
});

app.post('/api/users/change-password', (req, res) => {
    const { user_id, current_password, new_password } = req.body;
    db.get('SELECT id FROM users WHERE id = ? AND password = ?', [user_id, current_password], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
        db.run('UPDATE users SET password = ? WHERE id = ?', [new_password, user_id], (err2) => {
            if (err2) return res.status(500).json({ error: 'Không thể cập nhật mật khẩu' });
            res.json({ success: true });
        });
    });
});

app.post('/api/users/:id/reset-password', (req, res) => {
    const userId = Number(req.params.id);
    db.run('UPDATE users SET password = "123456" WHERE id = ?', [userId], (err) => {
        if (err) return res.status(500).json({ error: 'Lỗi đặt lại mật khẩu' });
        res.json({ success: true });
    });
});

// ================= API QUẢN LÝ CÁN BỘ (USERS) =================
app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, full_name, title, department, role, can_approve FROM users ORDER BY id ASC', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Lỗi nạp danh sách cán bộ' });
        res.json(rows || []);
    });
});

app.post('/api/users', (req, res) => {
    const { username, password, full_name, title, department, role, can_approve } = req.body;
    db.run(`INSERT INTO users (username, password, full_name, title, department, role, can_approve)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [username.trim(), password || '123456', full_name.trim(), title, department, role || 'staff', can_approve ? 1 : 0],
        function(err) {
            if (err) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại trong hệ thống' });
            res.json({ success: true, id: this ? this.lastID : 0 });
        }
    );
});

app.put('/api/users/:id', (req, res) => {
    const userId = Number(req.params.id);
    const { full_name, title, department, role, can_approve } = req.body;
    db.run(`UPDATE users SET full_name = ?, title = ?, department = ?, role = ?, can_approve = ? WHERE id = ?`,
        [full_name.trim(), title, department, role, can_approve ? 1 : 0, userId],
        (err) => {
            if (err) return res.status(500).json({ error: 'Lỗi cập nhật cán bộ' });
            res.json({ success: true });
        }
    );
});

app.patch('/api/users/:id/toggle-approve', (req, res) => {
    const userId = Number(req.params.id);
    const { can_approve } = req.body;
    db.run('UPDATE users SET can_approve = ? WHERE id = ?', [can_approve ? 1 : 0, userId], (err) => {
        if (err) return res.status(500).json({ error: 'Lỗi phân quyền' });
        res.json({ success: true });
    });
});

// API XÓA TÀI KHOẢN CÁN BỘ (HỖ TRỢ ĐỒNG THỜI SỐ VÀ CHUỖI, CHẶN XÓA ADMIN)
app.delete('/api/users/:id', (req, res) => {
    const rawId = req.params.id;
    const numId = Number(rawId);

    db.run('DELETE FROM users WHERE (id = ? OR id = ?) AND username != "admin"', [rawId, numId], function(err) {
        if (err) {
            console.error("Lỗi xóa tài khoản:", err.message);
            return res.status(500).json({ error: 'Lỗi máy chủ khi xóa tài khoản' });
        }
        res.json({ success: true });
    });
});

// ================= API PHÒNG HỌP (LOCATIONS) =================
app.get('/api/locations', (req, res) => {
    db.all('SELECT * FROM locations ORDER BY id ASC', (err, rows) => res.json(rows || []));
});

app.post('/api/locations', (req, res) => {
    const { name } = req.body;
    db.run('INSERT INTO locations (name) VALUES (?)', [name.trim()], function(err) {
        if (err) return res.status(400).json({ error: 'Địa điểm đã tồn tại' });
        res.json({ success: true, id: this ? this.lastID : 0 });
    });
});

app.delete('/api/locations/:id', (req, res) => {
    const id = Number(req.params.id);
    db.run('DELETE FROM locations WHERE id = ? OR id = ?', [req.params.id, id], () => res.json({ success: true }));
});

// ================= API NHÓM TRIỆU TẬP (ATTENDEE GROUPS) =================
app.get('/api/groups', (req, res) => {
    db.all('SELECT * FROM attendee_groups ORDER BY id ASC', (err, rows) => res.json(rows || []));
});

app.post('/api/groups', (req, res) => {
    const { name, member_ids } = req.body;
    db.run('INSERT INTO attendee_groups (name, member_ids) VALUES (?, ?)', [name.trim(), member_ids], function(err) {
        if (err) return res.status(400).json({ error: 'Tên nhóm đã tồn tại' });
        res.json({ success: true, id: this ? this.lastID : 0 });
    });
});

app.put('/api/groups/:id', (req, res) => {
    const id = Number(req.params.id);
    const { name, member_ids } = req.body;
    db.run('UPDATE attendee_groups SET name = ?, member_ids = ? WHERE id = ? OR id = ?', [name.trim(), member_ids, req.params.id, id], (err) => {
        if (err) return res.status(500).json({ error: 'Lỗi cập nhật nhóm' });
        res.json({ success: true });
    });
});

app.delete('/api/groups/:id', (req, res) => {
    const id = Number(req.params.id);
    db.run('DELETE FROM attendee_groups WHERE id = ? OR id = ?', [req.params.id, id], () => res.json({ success: true }));
});

// ================= API BAN / ĐƠN VỊ & CHỨC VỤ =================
app.get('/api/departments', (req, res) => {
    db.all('SELECT * FROM departments ORDER BY id ASC', (err, rows) => res.json(rows || []));
});

app.post('/api/departments', (req, res) => {
    db.run('INSERT INTO departments (name) VALUES (?)', [req.body.name.trim()], function(err) {
        if (err) return res.status(400).json({ error: 'Ban / Đơn vị đã tồn tại' });
        res.json({ success: true, id: this ? this.lastID : 0 });
    });
});

app.delete('/api/departments/:id', (req, res) => {
    const id = Number(req.params.id);
    db.run('DELETE FROM departments WHERE id = ? OR id = ?', [req.params.id, id], () => res.json({ success: true }));
});

app.get('/api/titles', (req, res) => {
    db.all('SELECT * FROM titles ORDER BY id ASC', (err, rows) => res.json(rows || []));
});

app.post('/api/titles', (req, res) => {
    db.run('INSERT INTO titles (name) VALUES (?)', [req.body.name.trim()], function(err) {
        if (err) return res.status(400).json({ error: 'Chức vụ đã tồn tại' });
        res.json({ success: true, id: this ? this.lastID : 0 });
    });
});

app.delete('/api/titles/:id', (req, res) => {
    const id = Number(req.params.id);
    db.run('DELETE FROM titles WHERE id = ? OR id = ?', [req.params.id, id], () => res.json({ success: true }));
});

// ================= API LỊCH CÔNG TÁC & RÀ SOÁT TRÙNG LỊCH =================
app.get('/api/schedules', (req, res) => {
    db.all('SELECT * FROM schedules ORDER BY date ASC, start_time ASC', (err, rows) => res.json(rows || []));
});

app.get('/api/schedules/public', (req, res) => {
    const { department } = req.query;
    let query = 'SELECT * FROM schedules WHERE status = "approved"';
    const params = [];
    if (department && department !== 'all') {
        query += ' AND department = ?';
        params.push(department);
    }
    query += ' ORDER BY date ASC, start_time ASC';
    db.all(query, params, (err, rows) => res.json(rows || []));
});

// Rà soát trùng lịch phòng họp hoặc người chủ trì
app.get('/api/schedules/:id/check-conflict', (req, res) => {
    const scheduleId = Number(req.params.id);
    db.get('SELECT * FROM schedules WHERE id = ? OR id = ?', [req.params.id, scheduleId], (err, current) => {
        if (err || !current) return res.json({ hasConflict: false });

        db.all('SELECT * FROM schedules WHERE date = ? AND status = "approved" AND id != ?', [current.date, current.id], (err2, approvedList) => {
            if (err2 || !approvedList || approvedList.length === 0) return res.json({ hasConflict: false });

            let conflictMsg = '';
            for (const item of approvedList) {
                // Kiểm tra giao thoa thời gian: max(start1, start2) < min(end1, end2)
                const isTimeOverlap = (current.start_time < item.end_time) && (item.start_time < current.end_time);
                if (isTimeOverlap) {
                    if (current.location === item.location) {
                        conflictMsg = `Trùng phòng họp "${current.location}" với cuộc họp: "${item.title}" (${item.start_time} - ${item.end_time}).`;
                        break;
                    }
                    if (current.chairperson_name && item.chairperson_name && current.chairperson_name === item.chairperson_name) {
                        conflictMsg = `Người chủ trì (${current.chairperson_name}) đã bận chủ trì cuộc họp: "${item.title}" (${item.start_time} - ${item.end_time}).`;
                        break;
                    }
                }
            }

            res.json({ hasConflict: !!conflictMsg, message: conflictMsg });
        });
    });
});

app.post('/api/schedules', (req, res) => {
    const {
        title, date, start_time, end_time, location, department,
        chairperson, chairperson_name, attendees, note, created_by_name, role, can_approve
    } = req.body;

    const autoApprove = (can_approve === 1 || role === 'approver' || role === 'admin');
    const status = autoApprove ? 'approved' : 'pending';
    const approved_by_name = autoApprove ? created_by_name : null;

    db.run(`INSERT INTO schedules (title, date, start_time, end_time, location, department, chairperson, chairperson_name, attendees, note, status, created_by_name, approved_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, date, start_time, end_time, location, department, chairperson, chairperson_name, attendees, note, status, created_by_name, approved_by_name],
        function(err) {
            if (err) return res.status(500).json({ error: 'Lỗi lưu cuộc họp' });
            const newScheduleId = this ? this.lastID : 0;

            // Nếu ban hành ngay, gửi thông báo đến các cán bộ tham dự
            if (status === 'approved') {
                createNotificationsForSchedule(newScheduleId, title, date, `${start_time} - ${end_time}`, location, chairperson_name, attendees);
            }

            res.json({ success: true, status, id: newScheduleId });
        }
    );
});

app.patch('/api/schedules/:id', (req, res) => {
    const scheduleId = Number(req.params.id);
    const { status, approved_by_name, reject_reason } = req.body;

    db.run('UPDATE schedules SET status = ?, approved_by_name = ?, reject_reason = ? WHERE id = ? OR id = ?',
        [status, approved_by_name || null, reject_reason || null, req.params.id, scheduleId],
        (err) => {
            if (err) return res.status(500).json({ error: 'Lỗi cập nhật trạng thái lịch' });

            if (status === 'approved') {
                db.get('SELECT * FROM schedules WHERE id = ? OR id = ?', [req.params.id, scheduleId], (err2, item) => {
                    if (!err2 && item) {
                        createNotificationsForSchedule(item.id, item.title, item.date, `${item.start_time} - ${item.end_time}`, item.location, item.chairperson_name, item.attendees);
                    }
                });
            }

            res.json({ success: true });
        }
    );
});

// ================= API THÔNG BÁO CÁ NHÂN =================
function createNotificationsForSchedule(scheduleId, title, date, timeRange, location, chairpersonName, attendeesStr) {
    db.all('SELECT id, full_name FROM users WHERE username != "admin"', (err, allUsers) => {
        if (err || !allUsers) return;

        allUsers.forEach(u => {
            const isChairperson = chairpersonName && chairpersonName.includes(u.full_name);
            const isAttendee = attendeesStr && attendeesStr.includes(u.full_name);

            if (isChairperson || isAttendee) {
                const roleInMeeting = isChairperson ? 'chairperson' : 'attendee';
                const msg = isChairperson 
                    ? `Đồng chí được phân công CHỦ TRÌ cuộc họp: "${title}"` 
                    : `Đồng chí được TRIỆU TẬP tham dự cuộc họp: "${title}"`;

                db.run(`INSERT INTO notifications (user_id, user_name, schedule_id, message, meeting_date, meeting_time, meeting_location, role_in_meeting)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [u.id, u.full_name, scheduleId, msg, date, timeRange, location, roleInMeeting]
                );
            }
        });
    });
}

app.get('/api/notifications', (req, res) => {
    const userId = Number(req.query.user_id);
    const userName = req.query.user_name || '';

    db.all('SELECT * FROM notifications WHERE (user_id = ? OR user_name = ?) ORDER BY id DESC LIMIT 20',
        [userId, userName],
        (err, rows) => res.json(rows || [])
    );
});

app.patch('/api/notifications/mark-read', (req, res) => {
    const userId = Number(req.body.user_id);
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId], () => res.json({ success: true }));
});

// Điều hướng trang chính
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi chạy Server
app.listen(PORT, '0.0.0.0', () => {
    console.log("==================================================");
    console.log("HỆ THỐNG QUẢN LÝ LỊCH HỌP ĐOÀN THANH NIÊN ĐANG CHẠY!");
    console.log(`* Cổng máy chủ: ${PORT}`);
    console.log("==================================================");
});
