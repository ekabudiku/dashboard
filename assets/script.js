document.addEventListener('DOMContentLoaded', () => {

    const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRW3dcWGJVtHxiS-fS_3FwqHKVKa-RB_LXq7i8fwVNQ4cFFBDmClvP492ha0Un5OtBsgUGwlOaxADgp/pub?output=csv';
    const GEOJSON_FOLDER_PATH = 'assets/data/';

    const SURVEYOR_DATA = [
        { nama: "Dea Riska Deviana", file: "0001_9101014211000002.geojson" },
        { nama: "Shabrina Rachmadani", file: "0001_3326106006020004.geojson" },
        { nama: "Yusuf Nugraha", file: "0001_3211222201860004.geojson" },
        { nama: "Muhammad Mu'adz Waliyyudin", file: "0001_3273021408990011.geojson" },
        { nama: "Deden Maulana Bahari", file: "0001_3207182412940001.geojson" },
        { nama: "Edi Budiyanto", file: "0001_3273140907780001.geojson" },
        { nama: "Muhamad Rizki Ramdhan", file: "0001_3273102412980001.geojson" },
        { nama: "Primma Handika Saputra", file: "0001_3204082908940004.geojson" },
        { nama: "Wisnu Rizky Setiawan", file: "0001_3272062511850001.geojson" },
        { nama: "M. Khazim Muhakam", file: "0001_1771012011920005.geojson" },
        { nama: "Tri Handoko", file: "0001_1509040810960003.geojson" },
        { nama: "Mochammad Adryan Nugraha", file: "0001_3273100404010001.geojson" },
        { nama: "Fanji Nasya", file: "0001_3305232905020001.geojson" },
        { nama: "Ujang Rohmat", file: "0001_3204352405010006.geojson" },
        { nama: "Gilang Permana Putra Hidayat", file: "0001_3273040905960004.geojson" },
        { nama: "Galuh Pamungkas", file: "0001_1509042608950004.geojson" },
        { nama: "Andika Putra Dwiyan", file: "0001_3204072001990001.geojson" },
        { nama: "Tri Eka Nugraha", file: "0001_3204351307040003.geojson" },
        { nama: "Azmi Nurahman", file: "0001_3204302801010002.geojson" },
        { nama: "Wildan Abdullah", file: "0001_3211140411870013.geojson" }
    ];

    let map, pieChart, areaBarChart, dailyChart, geojsonLayer, legend;
    let allProgresRows = [];
    let zonaGeoJSON;
    let surveyorTarget = {};
    let baseMapData = {};

    // ================== UTILS ==================
    function safeGet(row, key) {
        if (!row) return undefined;
        const keys = Object.keys(row);
        const found = keys.find(k => k.trim().toLowerCase() === key.trim().toLowerCase());
        return found ? row[found] : undefined;
    }

    function showLoading() {
        const el = document.getElementById("loading-overlay");
        if (el) el.style.display = "flex";
    }
    function hideLoading() {
        const el = document.getElementById("loading-overlay");
        if (el) el.style.display = "none";
    }

    // ================== INIT ==================
    async function initDashboard() {
        try {
            showLoading();

            // Step 1: load Google Sheet dengan cache 5 menit
            let progresData;
            const cacheKey = "progresCache";
            const cacheTimeKey = "progresCacheTime";
            const now = Date.now();
            const lastCache = sessionStorage.getItem(cacheTimeKey);

            if (lastCache && now - lastCache < 5 * 60 * 1000) {
                progresData = sessionStorage.getItem(cacheKey);
            } else {
                progresData = await fetch(GOOGLE_SHEET_URL).then(res => res.text());
                sessionStorage.setItem(cacheKey, progresData);
                sessionStorage.setItem(cacheTimeKey, now);
            }

            allProgresRows = Papa.parse(progresData, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            }).data;

            updateLastUpdateText();

            // Step 2: populate filter
            populateSurveyorFilter(SURVEYOR_DATA.map(d => d.nama));
            document.getElementById('surveyorFilter')
                .addEventListener('change', async (e) => {
                    const val = e.target.value;
                    await loadGeoJSONFor(val);
                    updateDashboardView();
                });

            // Step 3: load default data (semua)
            await loadGeoJSONFor('all');
            updateDashboardView();

        } catch (err) {
            console.error("❌ Gagal load dashboard:", err);
        } finally {
            hideLoading();
        }
    }

    // ================== DATA LOADER ==================
    async function loadGeoJSONFor(surveyor) {
        if (zonaGeoJSON && zonaGeoJSON.features.length > 0) return; // sudah pernah load semua

        const promisesZona = SURVEYOR_DATA.map(d =>
            fetch(GEOJSON_FOLDER_PATH + d.file)
                .then(res => res.json())
                .then(fc => { fc._surveyor = d.nama; return fc; })
                .catch(() => ({ type: "FeatureCollection", features: [], _surveyor: d.nama }))
        );

        const zonaFeatures = await Promise.all(promisesZona);

        const allFeatures = zonaFeatures.flatMap(fc =>
            (fc.features || []).map(f => {
                f.properties.Surveyor = fc._surveyor;
                return f;
            })
        );

        zonaGeoJSON = { type: "FeatureCollection", features: allFeatures };

        // hitung target surveyor
        surveyorTarget = {};
        zonaFeatures.forEach(fc => {
            const surveyorName = fc._surveyor;
            surveyorTarget[surveyorName] = fc.features.length || 0;
        });

        // siapkan base map data
        zonaGeoJSON.features.forEach((f, idx) => {
            const id = String(f.properties?.BagiZona || `zona_${idx}`);
            if (!baseMapData[id]) {
                baseMapData[id] = {
                    nama: f.properties?.Kecamatan || `Zona ${id}`,
                    selesai: 0,
                    surveyor: f.properties?.Surveyor || "-"
                };
            }
        });
    }

    // ================== DASHBOARD VIEW ==================
    function updateDashboardView() {
        const selectedSurveyor = document.getElementById('surveyorFilter').value;
        const filteredRows = selectedSurveyor === 'all'
            ? allProgresRows
            : allProgresRows.filter(r => safeGet(r, 'Surveyor') === selectedSurveyor);

        const { mapData } = processData(filteredRows);

        renderKPIs(mapData, selectedSurveyor);
        renderPieChart(mapData, selectedSurveyor);
        renderAreaBarChart(mapData, selectedSurveyor);
        renderDailyChart(filteredRows, selectedSurveyor);
        renderKeluhKesah(filteredRows);
        renderMap(mapData, zonaGeoJSON, selectedSurveyor);
    }

    function processData(progresRows) {
        const mapData = JSON.parse(JSON.stringify(baseMapData));
        Object.values(mapData).forEach(z => z.selesai = 0);

        progresRows.forEach(r => {
            let idRaw = safeGet(r, "Zona Survei (1-20)");
            const jumlah = safeGet(r, "Jumlah Titik Valid Disurvei Hari Ini");
            if (idRaw && jumlah !== undefined) {
                const id = String(idRaw).replace("Zona", "").trim();
                if (mapData[id]) mapData[id].selesai += Number(jumlah) || 0;
            }
        });

        return { mapData };
    }

    // ================== KPI ==================
    function renderKPIs(mapData, selectedSurveyor) {
        let totalSelesai = 0;
        for (const id in mapData) totalSelesai += mapData[id].selesai;

        let totalZona, totalTarget;
        if (selectedSurveyor === 'all') {
            totalZona = Object.values(surveyorTarget).reduce((a, b) => a + b, 0);
        } else {
            totalZona = surveyorTarget[selectedSurveyor] || 0;
        }
        totalTarget = totalZona * 3;

        let totalAreaSelesai;
        if (selectedSurveyor === 'all') {
            totalAreaSelesai = Math.floor(totalSelesai / 3);
        } else {
            totalAreaSelesai = Math.floor(
                Object.values(mapData)
                    .filter(z => z.surveyor === selectedSurveyor)
                    .reduce((a, z) => a + z.selesai, 0) / 3
            );
        }

        const progres = totalTarget > 0 ? ((totalSelesai / totalTarget) * 100).toFixed(1) : 0;

        document.getElementById('kpi-total-progres').innerText = `${progres}%`;
        document.getElementById('kpi-titik-selesai').innerText = totalSelesai.toLocaleString('id-ID');
        document.getElementById('kpi-target-info').innerText =
            `${totalSelesai.toLocaleString('id-ID')} / ${totalTarget.toLocaleString('id-ID')}`;
        document.getElementById('kpi-zona-tuntas').innerText =
            `${totalAreaSelesai} / ${totalZona} Zona`;
    }

    // ================== CHARTS ==================
    function renderPieChart(mapData, selectedSurveyor) {
        let totalSelesai = 0;
        for (const id in mapData) totalSelesai += mapData[id].selesai;

        let totalZona = selectedSurveyor === 'all'
            ? Object.values(surveyorTarget).reduce((a, b) => a + b, 0)
            : (surveyorTarget[selectedSurveyor] || 0);
        let totalTarget = totalZona * 3;
        let sisa = totalTarget - totalSelesai;

        const ctx = document.getElementById('pieChart').getContext('2d');
        if (pieChart) pieChart.destroy();
        pieChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Sudah Disurvei', 'Belum Disurvei'],
                datasets: [{
                    data: [totalSelesai, sisa > 0 ? sisa : 0],
                    backgroundColor: ['#5b86e5', '#e9ecef'],
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' }
                }
            }
        });
    }

    function renderAreaBarChart(mapData, selectedSurveyor) {
        const ctx = document.getElementById('areaBarChart').getContext('2d');
        const groups = {};

        Object.keys(surveyorTarget).forEach(s => {
            const targetZona = surveyorTarget[s];
            const target = targetZona * 3;
            let selesai = 0;
            Object.keys(mapData).forEach(id => {
                const z = mapData[id];
                if (z.surveyor === s) selesai += z.selesai;
            });
            groups[s] = { selesai, target };
        });

        const labels = Object.keys(groups);
        const data = labels.map(n => groups[n].target > 0 ? (groups[n].selesai / groups[n].target) * 100 : 0);

        if (areaBarChart) areaBarChart.destroy();
        areaBarChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Progres (%)',
                    data,
                    backgroundColor: '#9ecae1',
                    borderColor: '#3182bd',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true, max: 100 }
                }
            }
        });
    }

    function renderDailyChart(rows, selectedSurveyor) {
        const ctx = document.getElementById('dailyChart').getContext('2d');
        const grouped = {};

        rows.forEach(r => {
            const surveyor = safeGet(r, 'Surveyor');
            if (selectedSurveyor !== 'all' && surveyor !== selectedSurveyor) return;

            const tglStr = safeGet(r, 'Tanggal Survey');
            const jumlah = Number(safeGet(r, 'Jumlah Titik Valid Disurvei Hari Ini')) || 0;
            if (!tglStr || jumlah === 0) return;

            let dateObj;
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(tglStr)) {
                const parts = tglStr.split('/');
                dateObj = new Date(parts[2], parts[0] - 1, parts[1]);
            } else {
                dateObj = new Date(tglStr);
            }

            if (isNaN(dateObj.getTime())) {
                console.warn(`Format tanggal tidak valid dilewati: ${tglStr}`);
                return;
            }

            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            const tglKey = `${y}-${m}-${d}`;

            grouped[tglKey] = (grouped[tglKey] || 0) + jumlah;
        });

        const labels = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));
        const data = labels.map(d => grouped[d]);

        if (dailyChart) dailyChart.destroy();
        dailyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Jumlah Titik Valid / Hari',
                    data,
                    borderColor: '#5b86e5',
                    backgroundColor: 'rgba(91,134,229,0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: true, position: 'top' } },
                scales: {
                    x: { title: { display: true, text: 'Tanggal' } },
                    y: { title: { display: true, text: 'Jumlah Titik' }, beginAtZero: true }
                }
            }
        });
    }

    // ================== KELUH KESAH ==================
    function renderKeluhKesah(rows) {
        const listContainer = document.getElementById('keluh-kesah-list');
        listContainer.innerHTML = '';
        const data = rows.map(r => ({
            kendala: safeGet(r, 'Keluh Kesah'),
            surveyor: safeGet(r, 'Surveyor'),
            zona: safeGet(r, 'Zona Survei (1-20)')
        })).filter(d => d.kendala);

        if (data.length === 0) {
            listContainer.innerHTML = '<li class="list-group-item text-muted">Tidak ada data kendala untuk filter ini.</li>';
            return;
        }

        data.slice(0, 20).forEach(d => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<p class="mb-1">${d.kendala}</p>
                            <small class="text-muted"><strong>${d.surveyor || 'Tanpa Nama'}</strong> di ${d.zona || 'N/A'}</small>`;
            listContainer.appendChild(li);
        });
    }

    // ================== MAP ==================
    function renderMap(mapData, geojson, selectedSurveyor) {
        if (!map) {
            map = L.map('map').setView([-2.5489, 118.0149], 5);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
            }).addTo(map);

            legend = L.control({ position: 'bottomright' });
            legend.onAdd = function () {
                const div = L.DomUtil.create('div', 'info legend');
                const grades = [0, 10, 30, 50, 70, 90, 100];

                div.innerHTML += '<strong>Progres (%)</strong><br>';
                for (let i = 0; i < grades.length; i++) {
                    const p = grades[i] / 100;
                    div.innerHTML +=
                        '<i style="background:' + getWarnaGradasi(p) + '; width:18px; height:18px; display:inline-block; margin-right:6px;"></i> ' +
                        grades[i] + (grades[i + 1] ? '&ndash;' + grades[i + 1] + '<br>' : '+');
                }
                return div;
            };
            legend.addTo(map);
        }
        if (geojsonLayer) geojsonLayer.remove();

        const features = selectedSurveyor === 'all'
            ? geojson.features
            : geojson.features.filter(f => f.properties?.Surveyor === selectedSurveyor);

        geojsonLayer = L.geoJSON({ type: "FeatureCollection", features }, {
            style: f => {
                const surveyor = f.properties?.Surveyor;
                let selesai = 0, target = 0;

                if (surveyor) {
                    selesai = Object.values(mapData)
                        .filter(z => z.surveyor === surveyor)
                        .reduce((a, z) => a + z.selesai, 0);

                    target = (surveyorTarget[surveyor] || 0) * 3;
                }

                const p = target > 0 ? selesai / target : 0;

                return {
                    fillColor: getWarnaGradasi(p),
                    weight: 1.5,
                    opacity: 1,
                    color: 'white',
                    fillOpacity: 0.85
                };
            },
            onEachFeature: (f, layer) => {
                const surveyor = f.properties?.Surveyor;
                let selesai = 0, target = 0;
                if (surveyor) {
                    selesai = Object.values(mapData)
                        .filter(z => z.surveyor === surveyor)
                        .reduce((a, z) => a + z.selesai, 0);
                    target = (surveyorTarget[surveyor] || 0) * 3;
                }
                const p = target > 0 ? ((selesai / target) * 100).toFixed(1) : 0;

                layer.bindTooltip(
                    `Surveyor: ${surveyor || "N/A"}<br>Progres: ${p}%`,
                    { permanent: false, direction: "top" }
                );

                layer.on({
                    mouseover: e => e.target.setStyle({ weight: 4, color: '#333' }),
                    mouseout: () => geojsonLayer.resetStyle(layer),
                    click: e => updateDetailPanel(e.target.feature.properties, mapData)
                });
            }
        }).addTo(map);

        if (features.length > 0) map.fitBounds(geojsonLayer.getBounds());
    }

    function updateDetailPanel(props, mapData) {
        const id = String(props?.BagiZona || "unknown");
        const z = mapData[id] || { nama: id, selesai: 0, target: 3 };

        const areaSelesai = Math.floor(z.selesai / 3);
        const p = Math.round((z.selesai / 3) * 100);

        document.getElementById('detail-nama-zona').innerText = z.nama;
        document.getElementById('detail-progres').innerText = `${areaSelesai} Area (${z.selesai} Titik)`;
        document.getElementById('detail-target').innerText = "1 Area (3 Titik)";

        const bar = document.getElementById('detail-progress-bar');
        bar.style.width = `${p}%`;
        bar.innerText = `${p}%`;
        bar.setAttribute('aria-valuenow', p);
    }

    // ================== HELPER ==================
    function populateSurveyorFilter(names) {
        const filter = document.getElementById('surveyorFilter');
        names.sort().forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.innerText = n;
            filter.appendChild(opt);
        });
    }

    function getWarnaGradasi(p) {
        return p > 0.9 ? '#08519c' :
            p > 0.7 ? '#3182bd' :
            p > 0.5 ? '#6baed6' :
            p > 0.3 ? '#9ecae1' :
            p > 0.1 ? '#c6dbef' :
            '#f7fbff';
    }

    function updateLastUpdateText() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('id-ID', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Asia/Jakarta'
        });
        const lastUpdateText = "📅 Last Update: " + formatter.format(now);

        const marquee = document.getElementById('lastUpdateMarquee');
        if (marquee) marquee.textContent = lastUpdateText;
    }

    // Jalankan
    initDashboard();
});
