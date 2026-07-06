const https = require('https');

const options = {
  hostname: 'web.agespa-01.com',
  port: 8443,
  path: '/',
  method: 'GET',
  rejectUnauthorized: false, // 忽略证书错误
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  }
};

console.log('Sending request to https://web.agespa-01.com:8443/...');

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log('Headers:', res.headers);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\nContent Preview (first 1000 chars):');
    console.log(data.substring(0, 1000));
  });
});

req.on('error', (e) => {
  console.error('Error occurred:', e);
});

req.end();
