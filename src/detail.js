const button = document.querySelector('#copy-address');
button?.addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#candidate-address').textContent);
    status.textContent = '已复制；该地址尚未完成核验。';
  } catch {
    status.textContent = '复制失败，请手动选中上方地址复制。';
  }
});
