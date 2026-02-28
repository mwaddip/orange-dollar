import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { h } from 'vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-title-after': () =>
        h('span', { class: 'od-site-title' }, [
          'Orange ',
          h('span', { class: 'od-dollar' }, 'Dollar'),
        ]),
    });
  },
} satisfies Theme;
