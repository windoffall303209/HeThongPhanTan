# P2P Chat System

Hệ thống chat ngang hàng P2P cho đồ án **Hệ thống phân tán**.

Mục tiêu chính của project là chứng minh một mạng chat trong đó mỗi peer vừa là client vừa là server:

- Peer tự mở TCP server để nhận tin nhắn.
- Peer tự dùng TCP client để gửi tin nhắn trực tiếp tới peer khác.
- Bootstrap/Tracker server chỉ hỗ trợ khám phá peer, trạng thái online/offline, group metadata, offline queue và dashboard demo.
- Tin nhắn trực tiếp giữa hai peer không đi qua bootstrap server.

Project hiện là **Hybrid P2P**, không phải pure P2P. Bootstrap server tồn tại để đơn giản hóa discovery và lưu trạng thái phụ trợ, nhưng luồng chat direct vẫn là peer-to-peer qua TCP socket.

## 1. Tính năng chính

### Theo yêu cầu đề tài

- Peer tham gia mạng bằng cách đăng ký với bootstrap server hoặc thông qua một peer đã biết.
- Bootstrap cung cấp danh sách peer online/offline.
- Peer discovery: peer mới tìm được các peer khác trong mạng.
- Chat trực tiếp giữa hai peer qua TCP socket.
- Chat nhóm bằng cách gửi message tới từng thành viên nhóm.
- Mỗi peer gửi và nhận tin đồng thời.
- Peer vừa là client vừa là server.
- Xử lý nhiều kết nối TCP.
- Trạng thái online/offline bằng heartbeat và TTL.
- ACK ở tầng ứng dụng để xác nhận message đã được peer nhận xử lý.
- Timeout, retry và xử lý khi peer không phản hồi.

### Chức năng nâng cao

- Broadcast message tới toàn bộ peer online.
- Store-and-forward: lưu tin nhắn khi peer đích offline và giao lại khi peer online.
- Forward message: chuyển tiếp một tin nhắn đã gửi/đã nhận sang peer khác.
- Relay payload một hop ở tầng TCP để chứng minh peer có khả năng chuyển tiếp payload cho peer khác.
- Mã hóa nội dung message bằng AES-256-GCM.
- Web UI realtime bằng Socket.IO.
- File transfer qua TCP, dùng Base64 trong JSON payload.
- Churn simulation: peer mô phỏng rời mạng/tham gia lại.
- MySQL store và MemoryStore fallback.
- Smoke test tự động kiểm tra các yêu cầu P2P chính.

## 2. Kiến trúc

```text
                         +--------------------------+
                         | Bootstrap / Tracker      |
                         | - register / heartbeat   |
                         | - peer discovery         |
                         | - group metadata         |
                         | - offline queue          |
                         | - launcher dashboard     |
                         +------------+-------------+
                                      ^
                                      |
                         REST: register/sync/history
                                      |
        +-----------------------------+-----------------------------+
        |                                                           |
+-------+--------+        direct TCP socket         +---------------+--+
| Peer A         | <------------------------------> | Peer B           |
| Web: 3101      |                                  | Web: 3102        |
| TCP: 5101      |                                  | TCP: 5102        |
| client+server  |                                  | client+server    |
+-------+--------+                                  +--------+---------+
        |                                                    |
        |                 direct TCP socket                  |
        +----------------------------------------------------+
                             Peer C
                             Web: 3103
                             TCP: 5103
```

Luồng gửi direct message:

```text
Peer A Web UI
  -> Peer A local REST API
  -> Peer A TCP client
  -> Peer B TCP server
  -> Peer B xử lý payload
  -> Peer B trả ACK application-level
  -> Peer A cập nhật trạng thái delivered
```

Bootstrap không nằm trên đường truyền direct message. Nếu bootstrap tắt, các peer đã biết nhau vẫn có thể chat trực tiếp nhờ cache peer local; các chức năng discovery mới, offline queue, group metadata và history tập trung sẽ bị hạn chế.

## 3. Stack công nghệ

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Runtime | Node.js | Chạy bootstrap và peer process |
| Web backend | Express | Web UI và REST API |
| Realtime UI | Socket.IO | Đẩy message/log/state lên trình duyệt |
| P2P networking | `node:net` TCP socket | Gửi/nhận payload trực tiếp giữa peer |
| Database | MySQL | Lưu peer, group, message, ACK, offline queue, file metadata |
| Memory fallback | In-memory store | Cho phép demo khi MySQL chưa chạy |
| Template | EJS | Render Bootstrap UI và Peer UI |
| Upload | Multer | Nhận file từ Web UI |
| Encryption | AES-256-GCM | Mã hóa nội dung message |
| Config | dotenv | Đọc `.env` |

## 4. Cấu trúc thư mục

```text
.
├── src
│   ├── bootstrap
│   │   ├── server.js            # Bootstrap server
│   │   ├── routes.js            # API register, heartbeat, peers, groups, offline queue
│   │   ├── launcher.js          # Start/stop peer process từ dashboard
│   │   ├── views/index.ejs      # Bootstrap dashboard
│   │   └── public               # JS/CSS dashboard
│   │
│   ├── peer
│   │   ├── server.js            # Web server của từng peer
│   │   ├── routes/api.js        # Local REST API cho Web UI peer
│   │   ├── services
│   │   │   ├── peerRuntime.js   # Lõi P2P: send/receive/sync/queue/churn
│   │   │   └── bootstrapClient.js
│   │   ├── tcp
│   │   │   ├── client.js        # TCP client gửi frame và chờ ACK
│   │   │   └── server.js        # TCP server nhận frame và trả ACK
│   │   ├── views/index.ejs      # Peer Web UI
│   │   └── public               # JS/CSS Peer UI
│   │
│   ├── shared
│   │   ├── protocol.js          # Message types, JSON-line framing, ACK
│   │   ├── crypto.js            # AES-256-GCM encrypt/decrypt
│   │   └── http.js              # HTTP JSON helper
│   │
│   ├── database
│   │   └── store.js             # MySQLStore và MemoryStore
│   └── config.js                # Cấu hình từ biến môi trường
│
├── database/schema.sql          # MySQL schema
├── scripts/check-syntax.mjs     # Kiểm tra cú pháp JS
├── scripts/smoke-p2p-requirements.mjs
├── received_files               # File peer nhận được
├── bao-ve                       # Tài liệu/câu hỏi bảo vệ
└── docs                         # Tài liệu và báo cáo
```

## 5. Cài đặt

Yêu cầu:

- Node.js 18+.
- npm.
- MySQL nếu muốn lưu dữ liệu thật. Nếu chưa có MySQL, có thể dùng memory fallback để demo.

Cài dependency:

```bash
npm install
```

Tạo `.env` nếu chưa có:

```powershell
copy .env.example .env
```

Trên Git Bash/macOS/Linux:

```bash
cp .env.example .env
```

## 6. Cấu hình `.env`

Ví dụ cấu hình mặc định:

```env
BOOTSTRAP_PORT=3000
BOOTSTRAP_URL=http://127.0.0.1:3000
PEER_TTL_MS=30000

PEER_ID=peer-a
USERNAME=Alice
PEER_HOST=127.0.0.1
TCP_PORT=5101
WEB_PORT=3101

DB_ENABLED=true
DB_FALLBACK_MEMORY=true
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=admin
MYSQL_DATABASE=p2p_chat

TCP_TIMEOUT_MS=5000
SEND_RETRIES=2
HEARTBEAT_INTERVAL_MS=8000
PEER_SYNC_INTERVAL_MS=5000
OFFLINE_POLL_INTERVAL_MS=5000
MAX_FILE_BYTES=2097152

ENCRYPTION_ENABLED=true
P2P_SHARED_SECRET=change-this-secret-before-demo
```

Ý nghĩa các cấu hình quan trọng:

| Biến | Ý nghĩa |
|---|---|
| `BOOTSTRAP_PORT` | Port Web/API của bootstrap server |
| `BOOTSTRAP_URL` | URL peer dùng để gọi bootstrap |
| `PEER_TTL_MS` | Quá thời gian này không heartbeat thì peer bị coi offline |
| `TCP_PORT` | Port TCP server của peer |
| `WEB_PORT` | Port Web UI/API local của peer |
| `TCP_TIMEOUT_MS` | Timeout một lần gửi TCP |
| `SEND_RETRIES` | Số lần retry khi gửi TCP fail |
| `DB_FALLBACK_MEMORY` | Dùng RAM nếu MySQL lỗi |
| `P2P_SHARED_SECRET` | Secret chung để mã hóa AES-256-GCM |

## 7. Cấu hình MySQL

Tạo database/schema:

```bash
mysql -u root -p < database/schema.sql
```

Nếu muốn bắt buộc dùng MySQL thật:

```env
DB_ENABLED=true
DB_FALLBACK_MEMORY=false
```

Nếu muốn demo nhanh khi MySQL chưa chạy:

```env
DB_ENABLED=true
DB_FALLBACK_MEMORY=true
```

Khi fallback memory được dùng, dữ liệu chỉ nằm trong RAM và mất khi tắt bootstrap.

## 8. Chạy hệ thống

### Cách 1: chạy bằng terminal

Mở 4 terminal tại thư mục project.

Terminal 1:

```bash
npm run bootstrap
```

Terminal 2:

```bash
npm run peer:a
```

Terminal 3:

```bash
npm run peer:b
```

Terminal 4:

```bash
npm run peer:c
```

Mở các URL:

```text
Bootstrap: http://127.0.0.1:3000
Peer A:    http://127.0.0.1:3101
Peer B:    http://127.0.0.1:3102
Peer C:    http://127.0.0.1:3103
```

### Cách 2: chạy peer tùy chỉnh

PowerShell:

```powershell
$env:PEER_ID="peer-d"
$env:USERNAME="David"
$env:TCP_PORT="5104"
$env:WEB_PORT="3104"
npm run peer
```

Mở:

```text
http://127.0.0.1:3104
```

### Cách 3: dùng Bootstrap Launcher UI

Chạy bootstrap:

```bash
npm run bootstrap
```

Mở:

```text
http://127.0.0.1:3000
```

Tạo peer từ dashboard:

```text
peer-a / Alice / TCP 5101 / Web 3101
peer-b / Bob   / TCP 5102 / Web 3102
peer-c / Carol / TCP 5103 / Web 3103
```

Peer do launcher tạo được chạy detached, nên bootstrap tắt không kéo peer tắt theo.

## 9. Sử dụng Peer Web UI

Trong UI của từng peer:

- Sidebar trái hiển thị peer hiện tại, TCP/Web port, trạng thái và thống kê.
- Tab `Trực tiếp` hiển thị các peer khác.
- Tab `Nhóm` hiển thị nhóm chat.
- Chọn một peer để gửi direct message.
- Chọn nhóm để gửi group message.
- Chọn `Broadcast` để gửi tới toàn bộ peer online.
- Dùng nút `+` ở composer direct để gửi file.
- Bấm `Chuyen tiep` trên một message để forward message đó sang peer khác.
- Bấm `Sync` để đồng bộ peer/group/offline messages thủ công.
- Bấm `Churn` để mô phỏng peer rời mạng/tham gia lại.

Lưu ý:

- `Forward message` là thao tác người dùng: lấy một tin đã gửi/đã nhận rồi gửi lại sang peer khác.
- `Relay payload` là chức năng kỹ thuật ở tầng TCP: gửi message qua một peer trung gian. API vẫn có để chứng minh yêu cầu peer có thể chuyển tiếp payload, nhưng UI không đặt nút relay trong composer để tránh nhầm với forward message.

## 10. Kịch bản demo bảo vệ

1. Chạy bootstrap.
2. Chạy peer A, B, C.
3. Mở UI của cả ba peer.
4. Chứng minh discovery: mỗi peer thấy peer còn lại online.
5. Peer A gửi direct message cho Peer B.
6. Peer B nhận realtime; Peer A thấy trạng thái `delivered`.
7. Peer B forward message vừa nhận sang Peer C bằng nút `Chuyen tiep`.
8. Peer A tạo group gồm Peer B và Peer C.
9. Peer A gửi group message, B và C đều nhận.
10. Peer A gửi broadcast message, B và C đều nhận.
11. Tắt Peer C.
12. Peer A gửi tin cho Peer C, message được queue offline.
13. Chạy lại Peer C, message offline được giao lại.
14. Tắt bootstrap server.
15. Gửi direct message giữa hai peer đã biết nhau để chứng minh direct P2P vẫn hoạt động khi bootstrap sập.

## 11. Giao thức TCP

Hệ thống dùng JSON newline-delimited frame. Mỗi frame kết thúc bằng `\n`.

Ví dụ direct message:

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
  "createdAt": "2026-05-26T10:00:00.000Z"
}
```

Ví dụ ACK application-level:

```json
{
  "type": "ack",
  "messageId": "uuid",
  "fromPeerId": "peer-b",
  "status": "received",
  "receivedAt": "2026-05-26T10:00:01.000Z"
}
```

Tại sao cần ACK application-level dù TCP đã reliable:

- TCP chỉ xác nhận byte tới socket.
- ACK của hệ thống xác nhận message có `messageId` cụ thể đã được application parse và xử lý.
- Nếu không nhận ACK, sender retry hoặc chuyển sang offline queue/failed.

## 12. Message status

Một số trạng thái thường gặp:

| Status | Ý nghĩa |
|---|---|
| `sending` | Peer gửi đã tạo message và đang gửi |
| `delivered` | Peer đích đã nhận và trả ACK |
| `received` | Peer hiện tại nhận message từ peer khác |
| `partial` | Gửi nhóm/broadcast, một số peer nhận được, một số peer fail/queued |
| `failed` | Gửi thất bại |
| `failed_queued` | Gửi trực tiếp fail nhưng đã queue offline |
| `queued_offline` | Message được lưu chờ peer đích online |
| `delivered_from_queue` | Message offline đã được giao lại |
| `delivered_via_relay` | Message được gửi qua relay peer |

UI đã dedupe theo `messageId`, nên cùng một message khi status update không nên hiển thị trùng nhiều bản.

## 13. Database

Các bảng chính trong `database/schema.sql`:

| Bảng | Vai trò |
|---|---|
| `peers` | Peer id, host, TCP/Web port, status, last seen |
| `peer_status_logs` | Lịch sử thay đổi trạng thái peer |
| `chat_groups` | Metadata nhóm chat |
| `group_members` | Thành viên nhóm |
| `direct_messages` | Lịch sử tin nhắn trực tiếp |
| `group_messages` | Lịch sử tin nhắn nhóm |
| `offline_messages` | Queue store-and-forward |
| `message_acks` | Trạng thái ACK, số lần retry, lỗi gửi |
| `file_transfers` | Metadata file transfer |
| `system_logs` | Log hệ thống |

## 14. Scripts

| Script | Ý nghĩa |
|---|---|
| `npm run bootstrap` | Chạy bootstrap server |
| `npm run peer` | Chạy peer theo biến môi trường |
| `npm run peer:a` | Chạy peer-a/Alice ở Web 3101, TCP 5101 |
| `npm run peer:b` | Chạy peer-b/Bob ở Web 3102, TCP 5102 |
| `npm run peer:c` | Chạy peer-c/Carol ở Web 3103, TCP 5103 |
| `npm run dev:bootstrap` | Chạy bootstrap bằng nodemon |
| `npm run dev:peer` | Chạy peer bằng nodemon |
| `npm run check` | Kiểm tra cú pháp JS |
| `npm run smoke:p2p` | Smoke test các yêu cầu P2P chính |

## 15. Kiểm thử

Kiểm tra syntax:

```bash
npm run check
```

Smoke test P2P:

```bash
npm run smoke:p2p
```

Smoke test sẽ tự chạy bootstrap và peer A/B/C trên port test riêng, kiểm tra:

- peer discovery
- join qua introducer
- direct TCP chat
- user-level message forwarding
- group chat fan-out
- relay forwarding
- broadcast
- offline queue và redelivery
- direct chat sau khi bootstrap outage

## 16. API quan trọng

Peer local API:

| Method | Path | Ý nghĩa |
|---|---|---|
| `GET` | `/api/me` | Thông tin peer hiện tại |
| `GET` | `/api/peers` | Peer list local |
| `GET` | `/api/messages` | Message history local |
| `POST` | `/api/messages/direct` | Gửi direct message |
| `POST` | `/api/messages/group` | Gửi group message |
| `POST` | `/api/messages/forward` | Forward một message đã có |
| `POST` | `/api/messages/relay` | Gửi payload qua relay peer |
| `POST` | `/api/broadcast` | Broadcast tới peer online |
| `POST` | `/api/files` | Gửi file |
| `POST` | `/api/sync` | Sync peer/group/offline |
| `POST` | `/api/churn/start` | Bật churn simulation |
| `POST` | `/api/churn/stop` | Tắt churn simulation |

Bootstrap API:

| Method | Path | Ý nghĩa |
|---|---|---|
| `POST` | `/api/register` | Peer đăng ký vào mạng |
| `POST` | `/api/unregister` | Peer rời mạng |
| `POST` | `/api/heartbeat` | Cập nhật peer online |
| `GET` | `/api/peers` | Danh sách peer |
| `GET` | `/api/peers/:peerId` | Resolve peer cụ thể |
| `GET` | `/api/consolidated-sync/:peerId` | Sync peers/groups/offline messages |
| `POST` | `/api/offline-messages` | Lưu message offline |
| `GET` | `/api/offline-messages/:peerId` | Lấy message offline |
| `POST` | `/api/offline-messages/ack` | Đánh dấu offline message đã giao |

## 17. Troubleshooting

### Lỗi `404 Not Found: server returned text/html`

Thường do trình duyệt đang mở peer server bản cũ hoặc peer process chưa restart sau khi code đổi.

Cách xử lý:

1. Dừng toàn bộ terminal đang chạy `npm run peer:*`.
2. Dừng peer đang chạy từ Bootstrap Launcher nếu có.
3. Chạy lại `npm run bootstrap`, `npm run peer:a`, `npm run peer:b`, `npm run peer:c`.
4. Reload hard refresh trình duyệt.

### Port đang bị chiếm

Triệu chứng:

```text
EADDRINUSE
```

Cách xử lý:

- Đổi `TCP_PORT` hoặc `WEB_PORT`.
- Dừng process peer cũ.
- Không chạy hai peer cùng một TCP/Web port.

### Peer không thấy nhau

Kiểm tra:

- Bootstrap có chạy ở `http://127.0.0.1:3000` không.
- Peer log có `Registered with bootstrap` không.
- `.env` có đúng `BOOTSTRAP_URL` không.
- Bấm `Sync` trong UI peer.

### Gửi tin bị queue offline

Điều này đúng khi peer đích offline hoặc TCP không kết nối được. Khi peer đích online lại và sync/poll offline queue, message sẽ được giao với status `delivered_from_queue`.

### Bootstrap tắt thì peer có tắt theo không?

Không. Bootstrap shutdown không gọi stop-all peer. Peer do launcher tạo cũng chạy detached. Direct chat giữa peer đã biết nhau vẫn có thể hoạt động.

## 18. Điểm cần nói khi bảo vệ

### Vì sao vẫn gọi là P2P dù có bootstrap?

Bootstrap chỉ giúp discovery và lưu metadata. Tin direct đi từ TCP client của peer gửi tới TCP server của peer nhận. Vì vậy luồng chat chính là peer-to-peer.

### Bootstrap có phải single point of failure không?

Có, đối với discovery, offline queue, group metadata và history tập trung. Nhưng không phải single point cho direct chat giữa các peer đã biết nhau.

### TCP reliable rồi tại sao còn ACK?

TCP chỉ reliable ở mức byte stream. ACK application-level xác nhận messageId đã được application nhận, parse, xử lý và có thể cập nhật trạng thái delivery.

### Store-and-forward nằm ở đâu?

Offline queue nằm ở bootstrap store. Nếu MySQL bật thì lưu trong bảng `offline_messages`; nếu memory fallback thì lưu RAM.

### Hạn chế production

Project là prototype học thuật. Chưa có NAT traversal, authentication mạnh, public-key identity, chống replay đầy đủ, DHT discovery, multi-hop routing, chunked file streaming và TLS.

## 19. Dẫn chứng code nhanh

| Ý cần chứng minh | File |
|---|---|
| Peer vừa web server vừa TCP server | `src/peer/server.js`, `src/peer/tcp/server.js` |
| Peer gửi TCP trực tiếp | `src/peer/tcp/client.js`, `src/peer/services/peerRuntime.js` |
| Bootstrap discovery | `src/bootstrap/routes.js`, `src/peer/services/bootstrapClient.js` |
| Heartbeat/TTL online offline | `src/peer/services/peerRuntime.js`, `src/database/store.js` |
| ACK application-level | `src/shared/protocol.js`, `src/peer/tcp/server.js`, `src/peer/tcp/client.js` |
| JSON newline frame | `src/shared/protocol.js` |
| Offline queue | `src/bootstrap/routes.js`, `src/database/store.js` |
| Forward message | `src/peer/routes/api.js`, `src/peer/services/peerRuntime.js`, `src/peer/public/app.js` |
| Relay payload | `src/peer/services/peerRuntime.js`, `scripts/smoke-p2p-requirements.mjs` |
| Encryption | `src/shared/crypto.js` |
| File transfer | `src/peer/services/peerRuntime.js`, `src/peer/routes/api.js` |
| Smoke test yêu cầu P2P | `scripts/smoke-p2p-requirements.mjs` |
