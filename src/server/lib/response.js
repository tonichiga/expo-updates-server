function sendMultipartResponse({ res, protocolVersion, boundary, buffer }) {
  res.statusCode = 200;
  res.setHeader("expo-protocol-version", protocolVersion);
  res.setHeader("expo-sfv-version", 0);
  res.setHeader("cache-control", "private, max-age=0");
  res.setHeader("content-type", `multipart/mixed; boundary=${boundary}`);
  res.write(buffer);
  res.end();
}

export { sendMultipartResponse };
