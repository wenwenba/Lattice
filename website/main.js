import './style.css';
import { createApp } from 'vue';
import LatticeDemo from './LatticeDemo.vue';

createApp(LatticeDemo).mount('#lattice-demo');

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const label = button.querySelector('.copy-label');
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      label.textContent = '已复制';
      button.classList.add('copied');
      window.setTimeout(() => {
        label.textContent = '复制';
        button.classList.remove('copied');
      }, 1600);
    } catch {
      label.textContent = '请手动复制';
    }
  });
}

document.querySelector('#year').textContent = String(new Date().getFullYear());
