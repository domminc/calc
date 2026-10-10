/* 저장된 테마(light/dark)를 첫 그림 전에 적용해 깜빡임을 막는다. 없으면 시스템 설정을 따른다. */
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
