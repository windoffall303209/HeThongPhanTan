const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function syncAll() {
  for (const port of [3101, 3102, 3103]) {
    await postJson(`http://127.0.0.1:${port}/api/sync`, {});
  }
}

async function main() {
  await syncAll();
  await postJson('http://127.0.0.1:3101/api/messages/direct', {
    toPeerId: 'peer-b',
    content: 'Xin chào Bob, đây là tin nhắn trực tiếp qua TCP từ Alice.'
  });

  const groupResponse = await postJson('http://127.0.0.1:3101/api/groups', {
    name: 'Nhóm demo P2P',
    members: ['peer-b', 'peer-c']
  });
  const groupId = groupResponse.group.groupId;

  await postJson('http://127.0.0.1:3101/api/messages/group', {
    groupId,
    members: ['peer-b', 'peer-c'],
    content: 'Tin nhắn nhóm: Alice gửi riêng tới Bob và Carol qua TCP.'
  });

  await postJson('http://127.0.0.1:3101/api/broadcast', {
    content: 'Broadcast demo: gửi tới toàn bộ peer đang online trong mạng P2P.'
  });

  console.log(groupId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
