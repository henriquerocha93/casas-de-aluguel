// ==========================
// LOGIN & AUTENTICAÇÃO
// ==========================

const firebaseConfig = {
  apiKey: "AIzaSyBxLvYPA4ESwZUftTrlvJ3NNxWwqO0EgeY",
  authDomain: "hrc-imoveis.firebaseapp.com",
  projectId: "hrc-imoveis",
  storageBucket: "hrc-imoveis.firebasestorage.app",
  messagingSenderId: "627895479271",
  appId: "1:627895479271:web:e6e87ee0a7f05193f12b42",
  databaseURL: "https://hrc-imoveis-default-rtdb.firebaseio.com"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

async function initUsers() {
    return new Promise((resolve) => {
        database.ref('hrc_users').once('value', (snapshot) => {
            const users = snapshot.val();
            if (!users || Object.keys(users).length === 0) {
                const localUsers = JSON.parse(localStorage.getItem('hrc_users'));
                if (localUsers && localUsers.length > 0) {
                    let usersObj = {};
                    localUsers.forEach(u => usersObj[u.id] = u);
                    database.ref('hrc_users').set(usersObj).then(() => resolve());
                } else {
                    const adminUser = {
                        id: 'admin_root',
                        username: 'admin',
                        password: 'admin',
                        name: 'Administrador'
                    };
                    database.ref('hrc_users/admin_root').set(adminUser).then(() => resolve());
                }
            } else {
                resolve();
            }
        });
    });
}

async function authenticateCloud(username, password) {
    return new Promise((resolve) => {
        database.ref('hrc_users').once('value', (snapshot) => {
            const usersObj = snapshot.val();
            if (!usersObj) {
                resolve(null);
                return;
            }
            const users = Object.values(usersObj);
            const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
            resolve(user || null);
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.getItem('hrc_auth_token')) {
        window.location.href = 'index.html';
        return;
    }

    const loginForm = document.getElementById('login-form');
    const errorAlert = document.getElementById('error-alert');

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Conectando banco...';

    await initUsers();
    
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const userVal = document.getElementById('username').value.trim();
        const passVal = document.getElementById('password').value;
        const remember = document.getElementById('remember-me').checked;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Autenticando...';

        const user = await authenticateCloud(userVal, passVal);

        if (user) {
            const token = btoa(JSON.stringify({ 
                user: user.username, 
                name: user.name, 
                ts: Date.now() 
            }));

            if (remember) {
                localStorage.setItem('hrc_auth_token', token);
            } else {
                sessionStorage.setItem('hrc_auth_token', token);
            }

            localStorage.setItem('current_user', user.name);

            window.location.href = 'index.html';
        } else {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
            errorAlert.style.display = 'block';
            setTimeout(() => {
                errorAlert.style.display = 'none';
            }, 3000);
        }
    });
});
