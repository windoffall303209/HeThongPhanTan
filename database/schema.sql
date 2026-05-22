CREATE DATABASE IF NOT EXISTS p2p_chat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE p2p_chat;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS peers (
  peer_id VARCHAR(120) NOT NULL PRIMARY KEY,
  username VARCHAR(80) NOT NULL,
  host VARCHAR(120) NOT NULL,
  tcp_port INT NOT NULL,
  web_port INT NOT NULL,
  public_key TEXT NULL,
  status ENUM('online', 'offline') NOT NULL DEFAULT 'offline',
  last_seen TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_peers_status (status),
  INDEX idx_peers_username (username)
);

CREATE TABLE IF NOT EXISTS peer_status_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  peer_id VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_peer_status_logs_peer (peer_id)
);

CREATE TABLE IF NOT EXISTS chat_groups (
  group_id VARCHAR(80) NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  owner_peer_id VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_groups_owner (owner_peer_id)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id VARCHAR(80) NOT NULL,
  peer_id VARCHAR(120) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, peer_id),
  INDEX idx_group_members_peer (peer_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  message_id VARCHAR(80) NOT NULL PRIMARY KEY,
  from_peer_id VARCHAR(120) NOT NULL,
  to_peer_id VARCHAR(120) NOT NULL,
  content TEXT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  encryption_payload JSON NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'received',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_direct_from_to (from_peer_id, to_peer_id),
  INDEX idx_direct_created (created_at)
);

CREATE TABLE IF NOT EXISTS group_messages (
  message_id VARCHAR(80) NOT NULL PRIMARY KEY,
  group_id VARCHAR(80) NOT NULL,
  from_peer_id VARCHAR(120) NOT NULL,
  content TEXT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  encryption_payload JSON NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'received',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_group_messages_group (group_id),
  INDEX idx_group_messages_created (created_at)
);

CREATE TABLE IF NOT EXISTS offline_messages (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  target_peer_id VARCHAR(120) NOT NULL,
  message_payload JSON NOT NULL,
  status ENUM('pending', 'delivered') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP NULL,
  INDEX idx_offline_target_status (target_peer_id, status)
);

CREATE TABLE IF NOT EXISTS message_acks (
  message_id VARCHAR(80) NOT NULL,
  from_peer_id VARCHAR(120) NOT NULL,
  to_peer_id VARCHAR(120) NOT NULL,
  status VARCHAR(40) NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, from_peer_id, to_peer_id)
);

CREATE TABLE IF NOT EXISTS file_transfers (
  transfer_id VARCHAR(80) NOT NULL PRIMARY KEY,
  message_id VARCHAR(80) NOT NULL,
  from_peer_id VARCHAR(120) NOT NULL,
  to_peer_id VARCHAR(120) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'received',
  saved_path TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_file_transfers_peers (from_peer_id, to_peer_id)
);

CREATE TABLE IF NOT EXISTS system_logs (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  scope VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  meta_payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_system_logs_created (created_at)
);
