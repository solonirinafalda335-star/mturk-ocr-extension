const licenseList = document.getElementById('licenseList');
const freeBtn = document.getElementById('freeBtn');
const paidBtn = document.getElementById('paidBtn');

async function loadLicenses() {
  try {
    const res = await fetch('/api/licenses');
    if (!res.ok) throw new Error('Erreur récupération licences');
    const licenses = await res.json();

    licenseList.innerHTML = '';
    const today = new Date().toISOString().split('T')[0];

    for (const [code, data] of Object.entries(licenses)) {
      const expired = data.expires < today || !data.valid;
      const li = document.createElement('li');
      li.textContent = `${code} — expire le ${data.expires}`;
      if (expired) li.classList.add('expired');

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Supprimer';
      delBtn.className = 'delete-btn';
      delBtn.onclick = async () => {
        if (confirm(`Supprimer le code ${code} ?`)) {
          await fetch(`/api/licenses/${code}`, { method: 'DELETE' });
          loadLicenses();
        }
      };

      li.appendChild(delBtn);
      licenseList.appendChild(li);
    }
  } catch (e) {
    alert('Erreur lors du chargement des licences');
    console.error(e);
  }
}

async function createCode(duration) {
  try {
    const res = await fetch('/api/licenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration })
    });
    if (!res.ok) throw new Error('Erreur création code');
    const data = await res.json();
    alert(`Nouveau code créé : ${data.code} (expire le ${data.expires})`);
    loadLicenses();
  } catch (e) {
    alert('Erreur lors de la création du code');
    console.error(e);
  }
}

freeBtn.onclick = () => createCode(7);
paidBtn.onclick = () => createCode(30);

loadLicenses();
