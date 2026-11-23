# Speak Up — приложение

Веб-приложение (PWA) для Chrome на Android. Без сборки: обычные файлы.

- `index.html`, `style.css`, `app.js` — само приложение
- `data/` — копия фраз из `../base`. После правок базы скопируй файлы заново:
  `cp ../base/{core,travel,social,lessons}.json data/` и увеличь `VERSION` в `sw.js`
- `sw.js` — офлайн-кэш, `manifest.webmanifest` + `icons/` — установка на главный экран

Запуск на ПК: `py -m http.server 8765 --directory app` → http://localhost:8765

Озвучка — синтезатор речи телефона (английский и русский голоса Google).
Проверка речи — распознавание Chrome (en-US), нужен интернет и доступ к микрофону.
Прогресс хранится в браузере телефона.
