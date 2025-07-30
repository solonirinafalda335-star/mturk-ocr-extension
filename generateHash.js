const bcrypt = require('bcrypt');
const password = 'Solonirina93@';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Erreur lors du hash:', err);
    return;
  }
  console.log('Mot de passe:', password);
  console.log('Hash bcrypt généré:', hash);
});
