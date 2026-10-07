const menu = document.querySelector('.menu');
const nav = document.querySelector('.nav');
function closeMenu() {
  menu.setAttribute('aria-expanded', 'false');
  nav.classList.remove('open');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('open', open);
});
nav.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});
// Preserve links shared from the original design preview.
const previewRoutes = {
  '#home': '/', '#home/services': '/#services', '#home/approach': '/#approach',
  '#home/about': '/#about', '#cases': '/case-studies',
  '#case/product-setup': '/case-studies/product-setup',
  '#cases/content': '/case-studies#content', '#cases/knowledge': '/case-studies#knowledge',
  '#cases/commerce': '/case-studies#commerce'
};
if (location.pathname === '/' && previewRoutes[location.hash]) {
  location.replace(previewRoutes[location.hash]);
}
