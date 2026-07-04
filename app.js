(function() {
    "use strict";

    // ----- Модель данных (подразделы) -----
    const REQUIRED_SUBSECTIONS = [
        { id: 'basic', label: 'Основные сведения' },
        { id: 'structure', label: 'Структура и органы управления' },
        { id: 'documents', label: 'Документы' },
        { id: 'education', label: 'Образование' },
        { id: 'staff', label: 'Руководство. Педагогический состав' },
        { id: 'material', label: 'Материально-техническое обеспечение' },
        { id: 'paid', label: 'Платные образовательные услуги' },
        { id: 'finance', label: 'Финансово-хозяйственная деятельность' },
        { id: 'vacancies', label: 'Вакантные места для приема' },
        { id: 'accessible', label: 'Доступная среда' },
        { id: 'international', label: 'Международное сотрудничество' }
    ];

    // Ключевые слова для поиска подразделов (можно расширять)
    const SUBSECTION_KEYWORDS = {
        basic: ['основные сведения', 'общая информация', 'о школе'],
        structure: ['структура', 'органы управления', 'управление'],
        documents: ['документы', 'нормативные документы', 'локальные акты'],
        education: ['образование', 'образовательные программы', 'учебный план'],
        staff: ['руководство', 'педагогический состав', 'преподаватели', 'учителя'],
        material: ['материально-техническое', 'оснащение', 'оборудование'],
        paid: ['платные услуги', 'платные образовательные', 'дополнительные услуги'],
        finance: ['финансово-хозяйственная', 'финансы', 'бюджет'],
        vacancies: ['вакантные места', 'прием', 'поступление'],
        accessible: ['доступная среда', 'инклюзия', 'безбарьерная'],
        international: ['международное сотрудничество', 'международные']
    };

    // ----- Состояние -----
    let currentReport = null;
    let history = [];
    let currentFilter = 'all';

    // DOM-ссылки
    const siteUrlInput = document.getElementById('siteUrl');
    const checkBtn = document.getElementById('checkBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const reportContent = document.getElementById('reportContent');
    const recommendationsContainer = document.getElementById('recommendationsContainer');
    const overallStatus = document.getElementById('overallStatus');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportTextBtn = document.getElementById('exportTextBtn');
    const historyList = document.getElementById('historyList');
    const filterGroup = document.getElementById('filterGroup');
    const liveStatus = document.getElementById('liveStatus');

    // ----- Вспомогательные функции -----
    function getStatusClass(status) {
        if (status === 'found') return 'status-found';
        if (status === 'missing') return 'status-missing';
        return 'status-partial';
    }

    function statusText(status) {
        if (status === 'found') return '✅ Найден';
        if (status === 'missing') return '❌ Не найден';
        return '⚠️ Частично';
    }

    function overallText(status) {
        if (status === 'success') return '✅ Соответствует';
        if (status === 'warning') return '⚠️ Частично соответствует';
        return '❌ Не соответствует';
    }

    function overallBadgeClass(status) {
        if (status === 'success') return 'badge-success';
        if (status === 'warning') return 'badge-warning';
        return 'badge-danger';
    }

    function escapeHtml(str) {
        if (!str) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return str.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    // ----- Работа с localStorage -----
    function loadHistory() {
        try {
            const stored = localStorage.getItem('inspectorHistory');
            history = stored ? JSON.parse(stored) : [];
        } catch (_) { history = []; }
    }

    function saveHistory() {
        localStorage.setItem('inspectorHistory', JSON.stringify(history));
    }

    // ----- РЕАЛЬНАЯ ПРОВЕРКА САЙТА (без iframe) -----
    // Здесь используется fetch + DOMParser для парсинга HTML
    async function performRealInspection(url) {
        try {
            // 1. Загружаем HTML страницы через fetch (прокси может понадобиться)
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'text/html'
                }
            });

            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${response.status} ${response.statusText}`);
            }

            const html = await response.text();
            
            // 2. Парсим HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 3. Ищем все ссылки и заголовки
            const allLinks = Array.from(doc.querySelectorAll('a'));
            const allHeadings = Array.from(doc.querySelectorAll('h1, h2, h3'));
            const allTextContent = [];

            // Собираем весь текст с сайта для поиска
            doc.querySelectorAll('*').forEach(el => {
                if (el.textContent) {
                    allTextContent.push(el.textContent.toLowerCase());
                }
            });

            // Собираем текст ссылок и их атрибуты
            const linkTexts = allLinks.map(link => ({
                text: link.textContent.toLowerCase(),
                href: link.getAttribute('href') || '',
                title: link.getAttribute('title') || ''
            }));

            const headingTexts = allHeadings.map(h => h.textContent.toLowerCase());

            // Объединяем все тексты для поиска
            const allTexts = [...allTextContent, ...linkTexts.map(l => l.text), ...headingTexts];

            // 4. Проверяем наличие раздела "Сведения об образовательной организации"
            const mainSectionKeywords = ['сведения об образовательной организации', 'сведения об оо', 'сведения о школе'];
            const mainSectionFound = mainSectionKeywords.some(keyword => 
                allTexts.some(text => text.includes(keyword))
            );

            const foundSections = [];

            if (mainSectionFound) {
                // Проверяем каждый обязательный подраздел
                REQUIRED_SUBSECTIONS.forEach((sub) => {
                    const keywords = SUBSECTION_KEYWORDS[sub.id] || [sub.label.toLowerCase()];
                    
                    // Ищем в тексте ссылок
                    let found = false;
                    let partial = false;

                    for (const keyword of keywords) {
                        // Полное совпадение
                        const exactMatch = allTexts.some(text => text.includes(keyword));
                        if (exactMatch) {
                            found = true;
                            break;
                        }
                        // Частичное совпадение (например, содержит часть слова)
                        const partialMatch = allTexts.some(text => {
                            const words = keyword.split(' ');
                            return words.some(word => word.length > 3 && text.includes(word));
                        });
                        if (partialMatch) {
                            partial = true;
                        }
                    }

                    let status;
                    let comment;
                    if (found) {
                        status = 'found';
                        comment = 'Ссылка или раздел обнаружен';
                    } else if (partial) {
                        status = 'partial';
                        comment = 'Обнаружено частичное совпадение';
                    } else {
                        status = 'missing';
                        comment = 'Не найдено';
                    }

                    foundSections.push({
                        id: sub.id,
                        label: sub.label,
                        status: status,
                        comment: comment
                    });
                });

                // Проверяем наличие версии для слабовидящих
                const blindKeywords = ['версия для слабовидящих', 'для слабовидящих', 'увеличительное стекло', 'лупа'];
                const hasBlind = blindKeywords.some(keyword =>
                    allTexts.some(text => text.includes(keyword))
                );

                // Подсчитываем результат
                const foundCount = foundSections.filter(s => s.status === 'found').length;
                const total = foundSections.length;
                let overall;
                if (foundCount === total) overall = 'success';
                else if (foundCount >= total * 0.6) overall = 'warning';
                else overall = 'danger';

                // Формируем рекомендации
                const recommendations = [];
                const missingSections = foundSections.filter(s => s.status === 'missing');
                const partialSections = foundSections.filter(s => s.status === 'partial');

                if (missingSections.length > 0) {
                    const names = missingSections.map(s => s.label).join(', ');
                    recommendations.push(`Добавьте подразделы: ${names}`);
                }

                if (partialSections.length > 0) {
                    const names = partialSections.map(s => s.label).join(', ');
                    recommendations.push(`Уточните названия подразделов: ${names}`);
                }

                if (!hasBlind) {
                    recommendations.push('Разместите версию для слабовидящих (иконка или текст)');
                }

                if (!mainSectionFound) {
                    recommendations.push('Создайте специальный раздел «Сведения об образовательной организации»');
                }

                return {
                    url,
                    timestamp: new Date().toISOString(),
                    overall,
                    subsections: foundSections,
                    recommendations,
                    mainSectionExists: mainSectionFound,
                    blindVersionExists: hasBlind
                };

            } else {
                // Если раздел не найден
                const subsections = REQUIRED_SUBSECTIONS.map(s => ({
                    id: s.id,
                    label: s.label,
                    status: 'missing',
                    comment: 'Раздел не найден'
                }));

                return {
                    url,
                    timestamp: new Date().toISOString(),
                    overall: 'danger',
                    subsections,
                    recommendations: ['Создайте специальный раздел «Сведения об образовательной организации»'],
                    mainSectionExists: false,
                    blindVersionExists: false
                };
            }

        } catch (error) {
            // Обработка ошибок загрузки
            console.error('Ошибка при загрузке сайта:', error);
            
            // Возвращаем отчёт с ошибкой
            const subsections = REQUIRED_SUBSECTIONS.map(s => ({
                id: s.id,
                label: s.label,
                status: 'missing',
                comment: 'Ошибка загрузки: ' + error.message
            }));

            return {
                url,
                timestamp: new Date().toISOString(),
                overall: 'danger',
                subsections,
                recommendations: [`Не удалось загрузить сайт: ${error.message}. Проверьте CORS или используйте прокси-сервер.`],
                mainSectionExists: false,
                blindVersionExists: false,
                error: error.message
            };
        }
    }

    // ----- Основная проверка (асинхронная) -----
    async function runCheck(url) {
        if (!url) {
            errorMessage.textContent = 'Введите URL сайта.';
            errorMessage.classList.remove('hidden');
            return;
        }

        // Валидация URL
        try {
            const parsed = new URL(url);
            if (!parsed.protocol.startsWith('http')) throw new Error();
        } catch (_) {
            errorMessage.textContent = 'Некорректный URL. Убедитесь, что адрес начинается с http:// или https://';
            errorMessage.classList.remove('hidden');
            return;
        }

        errorMessage.classList.add('hidden');
        loadingIndicator.classList.remove('hidden');
        checkBtn.disabled = true;
        liveStatus.textContent = '⏳ Загрузка...';
        liveStatus.className = 'status-badge';

        try {
            // Выполняем реальную проверку
            const report = await performRealInspection(url);
            currentReport = report;
            history.unshift(report);
            if (history.length > 50) history.pop();
            saveHistory();
            renderReport(report);
            renderHistory(currentFilter);
            exportJsonBtn.disabled = false;
            exportTextBtn.disabled = false;
            liveStatus.textContent = '✅ Готово';
            liveStatus.className = 'status-badge badge-success';
        } catch (err) {
            errorMessage.textContent = 'Ошибка при проверке: ' + err.message;
            errorMessage.classList.remove('hidden');
            liveStatus.textContent = '❌ Ошибка';
            liveStatus.className = 'status-badge badge-danger';
        } finally {
            loadingIndicator.classList.add('hidden');
            checkBtn.disabled = false;
        }
    }

    // ----- Отрисовка отчёта -----
    function renderReport(report) {
        if (!report) return;
        const { url, timestamp, overall, subsections, recommendations } = report;

        overallStatus.textContent = overallText(overall);
        overallStatus.className = 'status-badge ' + overallBadgeClass(overall);

        let html = `<div class="mb-8"><strong>🌐 URL:</strong> ${escapeHtml(url)}</div>`;
        html += `<div class="mb-8"><strong>🕒 Дата:</strong> ${new Date(timestamp).toLocaleString()}</div>`;
        
        if (report.error) {
            html += `<div class="mb-8" style="color:#d1435a;"><strong>⚠️ Ошибка:</strong> ${escapeHtml(report.error)}</div>`;
        }

        html += `<div class="report-grid">`;

        subsections.forEach(sub => {
            const statusCls = getStatusClass(sub.status);
            html += `<div class="report-item">
                        <span class="label">${escapeHtml(sub.label)}</span>
                        <span class="status ${statusCls}">${statusText(sub.status)}</span>
                     </div>`;
        });

        const blind = report.blindVersionExists ? '✅ Найдена' : '❌ Не найдена';
        html += `<div class="report-item">
                    <span class="label">👁 Версия для слабовидящих</span>
                    <span class="status ${report.blindVersionExists ? 'status-found' : 'status-missing'}">${blind}</span>
                 </div>`;
        html += `</div>`;

        reportContent.innerHTML = html;

        if (recommendations && recommendations.length) {
            let recHtml = `<div class="recommend"><strong>📌 Рекомендации:</strong><ul>`;
            recommendations.forEach(r => { recHtml += `<li>${escapeHtml(r)}</li>`; });
            recHtml += `</ul></div>`;
            recommendationsContainer.innerHTML = recHtml;
        } else {
            recommendationsContainer.innerHTML = `<div class="recommend" style="border-left-color:#1a9e6b;"><strong>✅ Все требования выполнены</strong></div>`;
        }
    }

    // ----- Удаление записи из истории -----
    function deleteHistoryItem(index) {
        if (index < 0 || index >= history.length) return;
        
        if (!confirm(`Удалить запись для сайта ${history[index].url}?`)) return;
        
        history.splice(index, 1);
        saveHistory();
        renderHistory(currentFilter);
        
        if (currentReport && history.length === 0) {
            currentReport = null;
            reportContent.innerHTML = `<p class="text-muted">После проверки здесь появится отчёт.</p>`;
            recommendationsContainer.innerHTML = '';
            overallStatus.textContent = '—';
            overallStatus.className = 'status-badge';
            exportJsonBtn.disabled = true;
            exportTextBtn.disabled = true;
            liveStatus.textContent = 'Готов к проверке';
            liveStatus.className = 'status-badge';
        }
    }

    // ----- История -----
    function renderHistory(filter) {
        const filtered = filter === 'all' ? history : history.filter(h => h.overall === filter);
        if (!filtered.length) {
            historyList.innerHTML = `<p class="text-muted">Нет записей.</p>`;
            return;
        }
        let html = `<div class="history-list">`;
        filtered.forEach((item) => {
            const realIndex = history.indexOf(item);
            const date = new Date(item.timestamp).toLocaleString();
            const statusCls = item.overall === 'success' ? 'badge-success' :
                              item.overall === 'warning' ? 'badge-warning' : 'badge-danger';
            
            html += `<div class="history-item" data-index="${realIndex}">
                        <span class="url">${escapeHtml(item.url)}</span>
                        <div class="status-wrapper">
                            <span class="status-badge ${statusCls}">${overallText(item.overall)}</span>
                            <span class="date">${date}</span>
                        </div>
                        <div class="delete-wrapper">
                            <button class="btn-delete" data-index="${realIndex}" title="Удалить запись">✕</button>
                        </div>
                     </div>`;
        });
        html += `</div>`;
        historyList.innerHTML = html;

        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const index = parseInt(this.dataset.index);
                deleteHistoryItem(index);
            });
        });
    }

    // ----- Экспорт -----
    function exportJSON() {
        if (!currentReport) return;
        const data = JSON.stringify(currentReport, null, 2);
        downloadFile(data, 'report.json', 'application/json');
    }

    function exportText() {
        if (!currentReport) return;
        const r = currentReport;
        let lines = [];
        lines.push(`Отчёт по проверке сайта: ${r.url}`);
        lines.push(`Дата: ${new Date(r.timestamp).toLocaleString()}`);
        lines.push(`Общий статус: ${overallText(r.overall)}`);
        lines.push('--- Подразделы ---');
        r.subsections.forEach(s => {
            lines.push(`${s.label}: ${statusText(s.status)} (${s.comment})`);
        });
        lines.push(`Версия для слабовидящих: ${r.blindVersionExists ? 'Найдена' : 'Не найдена'}`);
        if (r.recommendations && r.recommendations.length) {
            lines.push('--- Рекомендации ---');
            r.recommendations.forEach(rec => lines.push('- ' + rec));
        }
        downloadFile(lines.join('\n'), 'report.txt', 'text/plain');
    }

    function downloadFile(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    // ----- Инициализация и обработчики -----
    function init() {
        loadHistory();
        renderHistory('all');

        checkBtn.addEventListener('click', function() {
            const url = siteUrlInput.value.trim();
            runCheck(url);
        });

        siteUrlInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') checkBtn.click();
        });

        clearHistoryBtn.addEventListener('click', function() {
            if (confirm('Удалить всю историю?')) {
                history = [];
                saveHistory();
                renderHistory(currentFilter);
                if (currentReport) {
                    currentReport = null;
                    reportContent.innerHTML = `<p class="text-muted">После проверки здесь появится отчёт.</p>`;
                    recommendationsContainer.innerHTML = '';
                    overallStatus.textContent = '—';
                    overallStatus.className = 'status-badge';
                    exportJsonBtn.disabled = true;
                    exportTextBtn.disabled = true;
                    liveStatus.textContent = 'Готов к проверке';
                    liveStatus.className = 'status-badge';
                }
            }
        });

        exportJsonBtn.addEventListener('click', exportJSON);
        exportTextBtn.addEventListener('click', exportText);

        filterGroup.addEventListener('click', function(e) {
            const btn = e.target.closest('.filter-btn');
            if (!btn) return;
            const filter = btn.dataset.filter;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = filter;
            renderHistory(filter);
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
