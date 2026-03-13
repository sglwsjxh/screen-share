const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 50 * 1024 * 1024
});

// 静态文件服务
app.use(express.static('public'));

// 获取本机局域网 IP
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// 计算字符串显示宽度（中文占2）
function displayWidth(str) {
    let width = 0;
    for (const char of str) {
        width += char.charCodeAt(0) > 127 ? 2 : 1;
    }
    return width;
}

// 填充字符串到目标宽度
function padDisplay(str, targetWidth) {
    const current = displayWidth(str);
    const padding = Math.max(0, targetWidth - current);
    return str + ' '.repeat(padding);
}

// 打印启动信息框
function printStartupBox(title, lines) {
    const allLines = [title, ...lines];
    const maxWidth = Math.max(...allLines.map(line => displayWidth(line)));
    const boxWidth = maxWidth + 2;

    const horizontal = '─'.repeat(boxWidth);
    const top = `┌${horizontal}┐`;
    const bottom = `└${horizontal}┘`;
    const separator = `├${horizontal}┤`;

    console.log('');
    console.log(top);
    console.log(`│${padDisplay(title, boxWidth)}│`);
    console.log(separator);
    lines.forEach(line => {
        console.log(`│${padDisplay(line, boxWidth)}│`);
    });
    console.log(bottom);
    console.log('');
}

// 全局状态
let broadcaster = null;
let broadcasterInfo = null;
const viewers = new Map();
const viewerAudioStatus = new Map();

// Socket.IO 连接处理
io.on('connection', (socket) => {
    console.log(`[连接] ${socket.id}`);

    // 通知当前广播状态
    socket.emit('broadcaster-status', {
        active: !!broadcaster,
        info: broadcasterInfo
    });

    // 开始广播
    socket.on('start-broadcast', (info) => {
        if (broadcaster) {
            socket.emit('error', '已有广播者存在');
            return;
        }
        broadcaster = socket.id;
        broadcasterInfo = info || {};
        console.log(`[广播开始] ${socket.id}`, info);
        socket.broadcast.emit('broadcaster-status', {
            active: true,
            info: broadcasterInfo
        });
    });

    // 停止广播
    socket.on('stop-broadcast', () => {
        if (broadcaster === socket.id) {
            console.log(`[广播停止] ${socket.id}`);
            broadcaster = null;
            broadcasterInfo = null;
            io.emit('broadcaster-status', { active: false });
            io.emit('broadcast-ended');
            viewers.clear();
            viewerAudioStatus.clear();
        }
    });

    // 加入为观看者
    socket.on('join-as-viewer', () => {
        if (!broadcaster) {
            socket.emit('error', '当前没有广播');
            return;
        }
        viewers.set(socket.id, { joinedAt: Date.now() });
        io.to(broadcaster).emit('viewer-joined', { viewerId: socket.id });
        console.log(`[观看者加入] ${socket.id} (当前: ${viewers.size})`);
    });

    // 观看者麦克风状态
    socket.on('viewer-audio-status', (data) => {
        viewerAudioStatus.set(socket.id, data.enabled);
        if (broadcaster) {
            io.to(broadcaster).emit('viewer-audio-status', {
                viewerId: socket.id,
                enabled: data.enabled
            });
        }
    });

    // 转发统计信息
    socket.on('stats-report', (data) => {
        if (data.target) {
            io.to(data.target).emit('peer-stats', {
                from: socket.id,
                stats: data.stats
            });
        }
    });

    // 信令转发
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', { offer: data.offer, from: socket.id });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', { answer: data.answer, from: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log(`[断开] ${socket.id}`);
        if (broadcaster === socket.id) {
            broadcaster = null;
            broadcasterInfo = null;
            io.emit('broadcaster-status', { active: false });
            io.emit('broadcast-ended');
            viewers.clear();
            viewerAudioStatus.clear();
        } else {
            viewers.delete(socket.id);
            viewerAudioStatus.delete(socket.id);
            if (broadcaster) {
                io.to(broadcaster).emit('viewer-left', { viewerId: socket.id });
            }
        }
    });
});

// 启动服务
const PORT = 9000;
server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    printStartupBox('屏幕共享服务 已启动', [
        `本机:   http://localhost:${PORT}`,
        `局域网: http://${ip}:${PORT}`
    ]);
});