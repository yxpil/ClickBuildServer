// 作者：yxpil
/* 启动与路由：按模式把视图分派到真实页面。 */
function render() {
  if (!state.token && UX.auth && state.view !== 'home') {
    /* 未登录也允许看首页；需要登录的页面由各视图自己 requireAuth。 */
  }
  switch (UX.mode) {
    case 'content':
      if (state.view === 'home') return contentHome();
      if (state.view === 'collection') return contentCollection();
      if (state.view === 'item') return contentItem();
      if (state.view === 'my') return contentMy();
      if (state.view === 'admin') return contentAdmin();
      return contentHome();
    case 'commerce':
      if (state.view === 'home') return commerceHome();
      if (state.view === 'collection') return commerceCollection();
      if (state.view === 'item') return commerceItem();
      if (state.view === 'cart') return commerceCart();
      if (state.view === 'my') return commerceMy();
      if (state.view === 'order') return commerceOrder();
      if (state.view === 'admin') return commerceAdmin();
      return commerceHome();
    case 'catalog':
      if (state.view === 'home') return catalogHome();
      if (state.view === 'collection') return catalogCollection();
      if (state.view === 'item') return catalogItem();
      if (state.view === 'my') return catalogMy();
      if (state.view === 'admin') return catalogAdmin();
      return catalogHome();
    case 'desk':
      if (state.view === 'home') return deskHome();
      if (state.view === 'collection') return deskCollection();
      if (state.view === 'detail') return deskDetail();
      if (state.view === 'board') return deskBoard();
      if (state.view === 'pending') { state.params = { menu: 1 }; return deskCollection(); }
      if (state.view === 'customers') { state.params = { menu: deskMenu().findIndex((m) => m.label.indexOf('客户') >= 0) }; return deskCollection(); }
      if (state.view === 'routes') { state.params = { menu: deskMenu().findIndex((m) => m.label.indexOf('线路') >= 0) }; return deskCollection(); }
      if (state.view === 'alerts') { state.params = { menu: deskMenu().findIndex((m) => m.label.indexOf('告警') >= 0) }; return deskCollection(); }
      return deskHome();
    case 'chat':
      if (state.view === 'thread') return chatThread();
      return chatHome();
    case 'social':
      if (state.view === 'home') return socialHome();
      if (state.view === 'moment') return socialMoment();
      if (state.view === 'friends') return socialFriends();
      if (state.view === 'messages') return socialMessages();
      if (state.view === 'notifications') return socialNotifications();
      if (state.view === 'profile') return socialProfile();
      return socialHome();
    default:
      return contentHome();
  }
}
App.render = render;

function boot() {
  loadSession();
  renderChrome();
  refreshMe().finally(() => { renderChrome(); App.render(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
