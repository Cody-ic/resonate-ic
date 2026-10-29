/* Website reading controls. Original course sources and licenses are preserved. */
(() => {
  'use strict';
  // A migrated course keeps its immutable lesson assets, but its associated
  // project may have a different ID on another installation. Resolve the public
  // association rather than retaining a broken preview-only project URL.
  const courseLink=document.querySelector('.relay-coursebar a[href^="/courses/"]');
  const projectLink=document.querySelector('.relay-coursebar a[href^="/projects/"]');
  const courseId=courseLink?.getAttribute('href')?.match(/^\/courses\/([0-9a-f-]{36})$/i)?.[1];
  if(courseId&&projectLink){
    projectLink.href=courseLink.href;
    fetch(`/api/courses/${courseId}`,{credentials:'omit'})
      .then(response=>response.ok?response.json():null)
      .then(value=>{const id=value?.relatedProject?.id;if(/^[0-9a-f-]{36}$/i.test(id??''))projectLink.href=`/projects/${id}`;})
      .catch(()=>{});
  }
  const isImage = value => /\.(?:png|jpe?g|webp|gif|svg|bmp)(?:[?#]|$)/i.test(value || '');
  document.querySelectorAll('a[href]').forEach(link => {
    if (!isImage(link.getAttribute('href'))) return;
    const picture = link.querySelector('img');
    if (!picture) {
      // Downloadable experiment assets stay available from the original
      // repository, rather than being served as picture downloads here.
      const local = new URL(link.href), prefix = location.pathname.match(/^\/course-content\/smartwatch\/([0-9]+\.[0-9]+\.[0-9]+)\//);
      if (prefix && local.origin === location.origin && local.pathname.startsWith(prefix[0])) {
        const path = local.pathname.slice(prefix[0].length).split('/').map(encodeURIComponent).join('/');
        link.href = `https://github.com/Cody-ic/SmartWatch/blob/tutorial-v${prefix[1]}/tutorial/${path}`;
        link.removeAttribute('download'); link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = '在 GitHub 获取示例图片';
      }
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'course-picture-open';
    button.setAttribute('aria-label', '放大查看：' + (picture.alt || '课程插图'));
    button.append(...link.childNodes);
    button.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'course-picture-dialog';
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '关闭';
      const image = document.createElement('img');
      image.src = picture.currentSrc || picture.src; image.alt = picture.alt;
      image.draggable = false;
      const hint = document.createElement('p');
      hint.textContent = '课程插图仅供在线阅读；需要留存时可自行截图。';
      dialog.append(close, image, hint);
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      document.body.append(dialog); dialog.showModal();
    });
    link.replaceWith(button);
  });
  document.querySelectorAll('figcaption').forEach(caption => {
    const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) walker.currentNode.textContent = walker.currentNode.textContent
      .replace(/点击(?:图片)?可(?:以)?(?:打开|查看)原图。?/g, '点击图片可在本页放大查看。');
  });
  document.querySelectorAll('img').forEach(image => { image.draggable = false; });
  for (const name of ['contextmenu', 'dragstart']) document.addEventListener(name, event => {
    if (event.target instanceof Element && event.target.closest('img')) event.preventDefault();
  });
  const style = document.createElement('style');
  style.textContent = '.course-picture-open{display:block;width:100%;min-height:48px;padding:0;border:0;background:transparent;cursor:zoom-in}.course-picture-open:focus-visible{outline:2px solid currentColor;outline-offset:4px}.course-picture-dialog{max-width:94vw;max-height:92vh;padding:18px;border:1px solid #bbc5b7;border-radius:12px;background:#fff;color:#25382b}.course-picture-dialog::backdrop{background:#000a}.course-picture-dialog>button{display:block;margin:0 0 12px auto;padding:6px 16px;cursor:pointer}.course-picture-dialog img{display:block;max-width:100%;max-height:75vh;object-fit:contain}.course-picture-dialog p{font-size:13px;margin:12px 0 0}img{-webkit-user-drag:none}';
  document.head.append(style);
})();
