const form = document.getElementById('form');
const input = document.getElementById('password');
const error = document.getElementById('error');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true; error.textContent = '';
  try {
    const response = await fetch('./login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) { error.textContent = data.error || '暂时无法登录，请重试。'; return; }
    input.value = '';
    const target = new URLSearchParams(location.search).get('next');
    location.replace(target === '/quota-pocket/' ? target : '/quota-pocket/');
  } catch { error.textContent = '连接失败，请检查网络后再试。'; }
  finally { button.disabled = false; }
});
