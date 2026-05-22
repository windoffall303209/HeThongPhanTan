# P2P Chat System

Hệ thống chat ngang hàng P2P cho đồ án môn **Các hệ thống phân tán**. Project mô phỏng một mạng chat trong đó mỗi peer vừa là client, vừa là server: peer có thể gửi tin, nhận tin, gửi nhóm, broadcast, nhận file và xử lý tình huống peer offline.

Điểm quan trọng: **tin nhắn chat chính được truyền trực tiếp giữa các peer qua TCP socket**, không đi qua server trung tâm. Bootstrap server chỉ hỗ trợ peer discovery, trạng thái online/offline, group metadata, offline queue và dashboard demo.

## 1. Stack công nghệ

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Runtime | Node.js | Chạy bootstrap server và peer process |
| Web backend | Express | Cung cấp Web UI và REST API |
| Realtime UI | Socket.IO | Đẩy tin nhắn, log, trạng thái lên trình duyệt |
| P2P networking | `node:net` TCP socket | Gửi/nhận tin trực tiếp giữa peer |
| Database | MySQL | Lưu peer, group, message, ACK, offline queue, file transfer, log |
| Template UI | EJS | Render giao diện server-side |
| File upload | Multer | Nhận file từ Web UI trước khi gửi qua TCP |
| Encryption | AES-256-GCM | Mã hóa nội dung tin nhắn trên đường truyền TCP |
| Config | dotenv | Đọc biến môi trường từ `.env` |

## 2. Chức năng đã hoàn thiện

### Chức năng cơ bản theo đề tài

- Peer tham gia mạng P2P bằng cách đăng ký với bootstrap server.
- Bootstrap server cung cấp danh sách peer đang online.
- Peer discovery: peer mới tìm được peer khác trong mạng.
- Chat trực tiếp giữa hai peer qua TCP.
- Chat nhóm bằng cách gửi tin đến từng thành viên trong nhóm.
- Mỗi peer vừa gửi vừa nhận tin đồng thời.
- Quản lý trạng thái online/offline bằng heartbeat.
- ACK xác nhận peer đích đã nhận tin.
- Timeout và retry khi peer không phản hồi.
- Web UI hiển thị peer, group, message, log và trạng thái gửi.

### Chức năng nâng cao

- Broadcast message tới toàn bộ peer online.
- Store-and-forward: nếu peer offline, message được queue và giao lại khi peer online.
- Mã hóa tin nhắn bằng AES-256-GCM.
- Web UI realtime bằng Socket.IO.
- Bootstrap launcher UI để start/stop peer bằng form.
- File transfer giữa các peer qua TCP.
- Churn simulation: peer tự động rời mạng/tham gia lại để mô phỏng hệ phân tán động.
- Conversation filter: xem lịch sử theo từng cá nhân, từng nhóm hoặc broadcast.
- Lưu ACK, message history, group metadata, offline queue và system logs.

## 3. Kiến trúc tổng quan

```text
                   +----------------------+
                   |   Bootstrap Server   |
                   | Express + MySQL      |
                   | Peer discovery       |
                   | Offline queue        |
                   | Launcher UI          |
                   +----------+-----------+
                              ^
                              | register / heartbeat / get peers
                              |
+----------------+     TCP    |     TCP     +----------------+
| Peer A         |<---------->|<----------->| Peer B         |
| Web UI 3101    |            |             | Web UI 3102    |
| TCP 5101       |<----------------------->| TCP 5102       |
+----------------+            |             +----------------+
                              |
                    TCP       |
                 +------------v---+
                 | Peer C         |
                 | Web UI 3103    |
                 | TCP 5103       |
                 +----------------+
```

Bootstrap server không xử lý luồng chat chính. Khi Peer A gửi cho Peer B, dữ liệu đi theo hướng:

```text
Peer A TCP client -> Peer B TCP server -> Peer B trả ACK -> Peer A cập nhật delivered
```

## 4. Cấu trúc thư mục

```text
p2p-chat-system/
  src/
    bootstrap/
      server.js              REST API, bootstrap tracker, launcher routes
      launcher.js            Start/stop peer process từ Bootstrap UI
      views/index.ejs        Bootstrap launcher screen
      public/app.js          Logic frontend của launcher
      public/styles.css      CSS launcher

    peer/
      server.js              Web server của từng peer
      routes/api.js          API nội bộ cho Web UI peer
      services/
        peerRuntime.js       Điều phối P2P, TCP, bootstrap, message, file, churn
        bootstrapClient.js   Client gọi API bootstrap
      tcp/
        client.js            TCP client gửi payload và đợi ACK
        server.js            TCP server nhận payload và trả ACK
      views/index.ejs        Giao diện peer
      public/app.js          Logic frontend peer
      public/styles.css      CSS peer UI

    shared/
      protocol.js            Message type, frame encode/decode, ACK
      crypto.js              AES-256-GCM encrypt/decrypt
      http.js                Helper gọi HTTP JSON

    database/
      store.js               MySQL store và memory fallback

  database/schema.sql        MySQL schema
  docs/                      Tài liệu kiến trúc, API, demo, báo cáo
  scripts/check-syntax.mjs   Kiểm tra cú pháp JS bằng node --check
  received_files/            File nhận được từ peer khác
```

## 5. Cài đặt

Yêu cầu:

- Node.js 18+ hoặc mới hơn.
- npm.
- MySQL nếu muốn chạy với database thật.

Cài dependencies:

```bash
npm install
```

Tạo file `.env` từ mẫu:

```powershell
copy .env.example .env
```

Nếu dùng Git Bash/macOS/Linux:

```bash
cp .env.example .env
```

## 6. Cấu hình MySQL

Tạo database và bảng:

```bash
mysql -u root -p < database/schema.sql
```

Sửa file `.env`:

```env
DB_ENABLED=true
DB_FALLBACK_MEMORY=true
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=p2p_chat
```

Ý nghĩa:

- `DB_ENABLED=true`: bật kết nối MySQL.
- `DB_FALLBACK_MEMORY=true`: nếu MySQL chưa chạy, app vẫn chạy bằng RAM để demo.
- `DB_FALLBACK_MEMORY=false`: bắt buộc dùng MySQL, lỗi DB sẽ hiện rõ.

Khi bảo vệ đồ án, nên chạy MySQL thật để chứng minh có lưu dữ liệu. Khi luyện demo nhanh, có thể dùng memory fallback.

## 7. Chạy hệ thống

### Cách 1: Dùng Bootstrap Launcher UI

Chạy bootstrap:

```bash
npm run bootstrap
```

Mở trình duyệt:

```text
http://127.0.0.1:3000
```

Tại launcher, nhập:

```text
Peer ID: peer-a
Username: Alice
TCP Port: 5101
Web Port: 3101
Host: 127.0.0.1
```

Bấm **Start peer**. Tạo tiếp:

```text
peer-b / Bob   / TCP 5102 / WEB 3102
peer-c / Carol / TCP 5103 / WEB 3103
```

Mở UI từng peer:

```text
Peer A: http://127.0.0.1:3101
Peer B: http://127.0.0.1:3102
Peer C: http://127.0.0.1:3103
```

### Cách 2: Chạy peer bằng terminal

Mở 4 terminal:

```bash
npm run bootstrap
```

```bash
npm run peer:a
```

```bash
npm run peer:b
```

```bash
npm run peer:c
```

### Tạo peer mới bằng lệnh

PowerShell:

```powershell
$env:PEER_ID="peer-d"; $env:USERNAME="David"; $env:TCP_PORT="5104"; $env:WEB_PORT="3104"; npm run peer
```

Mở:

```text
http://127.0.0.1:3104
```

## 8. Cách sử dụng Web UI Peer

Mỗi peer UI có các vùng chính:

- Sidebar trái: thông tin peer hiện tại, TCP port, Web port, encryption, thống kê sent/delivered/failed/queued.
- Peers: danh sách peer khác đang online/offline.
- Direct tab: gửi tin trực tiếp tới một peer.
- Group tab: tạo nhóm và gửi tin nhóm.
- Broadcast tab: gửi tin tới toàn bộ peer online.
- File tab: gửi file nhỏ tới peer khác.
- Messages: lịch sử tin, có filter theo từng người, từng nhóm hoặc broadcast.
- Groups: danh sách nhóm mà peer đang tham gia.
- System log: log runtime như register, received message, queued offline, churn.

## 9. Kịch bản demo đề xuất

1. Start bootstrap server.
2. Mở `http://127.0.0.1:3000`.
3. Tạo Peer A, Peer B, Peer C từ launcher.
4. Mở UI của Peer A, B, C.
5. Chứng minh peer discovery: cả 3 peer nhìn thấy nhau online.
6. Peer A gửi direct message cho Peer B.
7. Peer B nhận realtime, Peer A thấy trạng thái `delivered`.
8. Peer A tạo group gồm Peer B và Peer C.
9. Peer A gửi group message.
10. Peer A gửi broadcast message.
11. Stop Peer C.
12. Peer A gửi tin cho Peer C, hệ thống retry rồi queue offline.
13. Start lại Peer C, tin offline được giao lại.
14. Peer A gửi file cho Peer B.
15. Bật churn simulation trên Peer B để mô phỏng join/leave.

## 10. Giao thức message TCP

Payload được gửi theo dạng JSON line, mỗi message kết thúc bằng `\n`.

Direct message:

```json
{
  "type": "direct_message",
  "messageId": "uuid",
  "fromPeerId": "peer-a",
  "fromUsername": "Alice",
  "toPeerId": "peer-b",
  "encrypted": true,
  "encryption": {
    "algorithm": "aes-256-gcm",
    "iv": "...",
    "tag": "...",
    "data": "..."
  },
  "createdAt": "2026-05-20T10:00:00.000Z"
}
```

ACK:

```json
{
  "type": "ack",
  "messageId": "uuid",
  "fromPeerId": "peer-b",
  "status": "received",
  "receivedAt": "2026-05-20T10:00:01.000Z"
}
```

## 11. Database

Các bảng chính:

| Bảng | Vai trò |
|---|---|
| `users` | Lưu username/display name |
| `peers` | Lưu peer id, host, TCP port, Web port, status |
| `chat_groups` | Lưu thông tin nhóm |
| `group_members` | Lưu thành viên nhóm |
| `direct_messages` | Lưu tin nhắn cá nhân |
| `group_messages` | Lưu tin nhắn nhóm |
| `offline_messages` | Lưu tin chờ giao khi peer offline |
| `message_acks` | Lưu ACK, attempts, lỗi gửi |
| `file_transfers` | Lưu metadata file transfer |
| `system_logs` | Lưu log hệ thống |

## 12. Scripts npm

| Script | Ý nghĩa |
|---|---|
| `npm run bootstrap` | Chạy bootstrap server và launcher UI |
| `npm run peer` | Chạy một peer theo biến môi trường |
| `npm run peer:a` | Chạy Alice ở TCP 5101, Web 3101 |
| `npm run peer:b` | Chạy Bob ở TCP 5102, Web 3102 |
| `npm run peer:c` | Chạy Carol ở TCP 5103, Web 3103 |
| `npm run check` | Kiểm tra cú pháp toàn bộ file JS |

## 13. Kiểm tra nhanh

```bash
npm run check
```

Test health bootstrap:

```text
http://127.0.0.1:3000/health
```

Test peer list:

```text
http://127.0.0.1:3000/api/peers
```

## 14. Troubleshooting

### Port đã được sử dụng

Lỗi thường gặp:

```text
EADDRINUSE
```

Cách xử lý:

- Đổi TCP/Web port khi tạo peer.
- Stop peer cũ từ launcher.
- Đóng terminal đang chạy peer.

### MySQL chưa chạy

Nếu `DB_FALLBACK_MEMORY=true`, app vẫn chạy bằng RAM. Nếu muốn dùng MySQL thật:

1. Bật MySQL service.
2. Chạy `database/schema.sql`.
3. Sửa đúng `MYSQL_USER`, `MYSQL_PASSWORD`.

### Peer không thấy peer khác

- Bấm `Sync now`.
- Kiểm tra bootstrap server còn chạy không.
- Kiểm tra peer có log `Registered with bootstrap`.
- Kiểm tra TCP/Web port không trùng.

### Gửi tin bị queued

Điều này đúng nếu peer đích offline. Khi peer đích online lại, nó sẽ poll offline queue và nhận tin.

## 15. Ghi chú bảo vệ

Khi giảng viên hỏi hệ thống có đúng P2P không, trả lời:

> Bootstrap server chỉ hỗ trợ tìm peer và lưu metadata. Tin nhắn chính đi trực tiếp từ TCP client của peer gửi tới TCP server của peer nhận. Vì vậy hệ thống vẫn là P2P, không phải client-server chat thông thường.

Khi hỏi vì sao vẫn có MySQL:

> MySQL dùng để lưu trạng thái, lịch sử, group, ACK và offline queue. Nó không phải kênh truyền tin nhắn chính.

Khi hỏi launcher có làm sai P2P không:

> Không. Launcher chỉ là công cụ demo để start/stop peer process. Sau khi peer được start, peer vẫn tự đăng ký, tự mở TCP server và tự giao tiếp với peer khác.
