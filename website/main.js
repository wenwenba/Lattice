import './style.css';
import { createApp } from 'vue';
import { addIcon } from 'iconify-icon';
import commandIcon from '@iconify-icons/lucide/command';
import copyIcon from '@iconify-icons/lucide/copy';
import folderTreeIcon from '@iconify-icons/lucide/folder-tree';
import githubIcon from '@iconify-icons/lucide/github';
import linkIcon from '@iconify-icons/lucide/link';
import panelsIcon from '@iconify-icons/lucide/panels-top-left';
import LatticeDemo from './LatticeDemo.vue';

for (const [name, icon] of Object.entries({ command: commandIcon, copy: copyIcon, folder: folderTreeIcon, github: githubIcon, link: linkIcon, panels: panelsIcon })) {
  addIcon(`lattice:${name}`, icon);
}

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
