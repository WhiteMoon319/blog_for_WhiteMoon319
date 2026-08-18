// 文集卡开合动画：展开走原生 toggle（0→内容高）；
// 收起先拦截 summary 点击，动画到 0 后再真正关闭——details 关闭后内容会被浏览器跳过渲染，
// 过渡无法运行，因此必须在关闭发生前完成动画。无 JS 时 details 原生行为兜底。
export function initCollectionAnim(root: ParentNode = document): void {
  for (const details of root.querySelectorAll<HTMLDetailsElement>('details.collection-block')) {
    const inner = details.querySelector<HTMLElement>('.collection-anim');
    const summary = details.querySelector<HTMLElement>('summary');
    if (!inner || !summary) continue;
    if (!details.open) inner.style.height = '0px';

    const animateTo = (from: number, target: number, done?: () => void) => {
      inner.style.transition = 'none';
      inner.style.height = `${from}px`;
      void inner.offsetHeight;
      inner.style.transition = '';
      inner.style.height = `${target}px`;
      const onEnd = () => {
        inner.removeEventListener('transitionend', onEnd);
        done?.();
      };
      inner.addEventListener('transitionend', onEnd);
    };

    details.addEventListener('toggle', () => {
      if (details.open) animateTo(0, inner.scrollHeight);
    });

    const beginClose = (e: Event) => {
      if (!details.open) return;
      e.preventDefault();
      if (inner.dataset.closing === '1') {
        delete inner.dataset.closing;
        animateTo(inner.getBoundingClientRect().height, inner.scrollHeight);
        return;
      }
      inner.dataset.closing = '1';
      animateTo(inner.scrollHeight, 0, () => {
        delete inner.dataset.closing;
        details.open = false;
      });
    };
    summary.addEventListener('click', beginClose);
    summary.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') beginClose(e);
    });
  }
  // 窗口尺寸变化后重算已展开卡片的展开高度，避免内容被裁剪
  window.addEventListener('resize', () => {
    for (const details of root.querySelectorAll<HTMLDetailsElement>('details.collection-block[open]')) {
      const inner = details.querySelector<HTMLElement>('.collection-anim');
      if (inner) inner.style.height = `${inner.scrollHeight}px`;
    }
  });
}