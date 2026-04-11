// ==========================
// LOGIN & AUTENTICAÇÃO
// ==========================

// Inicializar lista de usuários se estiver vazia
function initUsers() {
    let users = JSON.parse(localStorage.getItem('hrc_users')) || [];
    if (users.length === 0) {
        // Usuário padrão inicial
        users.push({
            id: 'admin_root',
            username: 'admin',
            password: 'admin',
            name: 'Administrador'
        });
        localStorage.setItem('hrc_users', JSON.stringify(users));
    }
}

// Lógica de login
document.addEventListener('DOMContentLoaded', () => {
    initUsers();
    
    // Se já estiver autenticado e o "Lembrar-me" foi usado, pula pro index
    if (localStorage.getItem('hrc_auth_token')) {
        window.location.href = 'index.html';
    }

    const loginForm = document.getElementById('login-form');
    const errorAlert = document.getElementById('error-alert');

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const userVal = document.getElementById('username').value.trim();
        const passVal = document.getElementById('password').value;
        const remember = document.getElementById('remember-me').checked;

        const users = JSON.parse(localStorage.getItem('hrc_users'));
        const user = users.find(u => u.username.toLowerCase() === userVal.toLowerCase() && u.password === passVal);

        if (user) {
            const token = btoa(JSON.stringify({ 
                user: user.username, 
                name: user.name, 
                ts: Date.now() 
            }));

            if (remember) {
                // Persistente (fecha o navegador e continua logado)
                localStorage.setItem('hrc_auth_token', token);
            } else {
                // Temporário (expira ao fechar o navegador)
                sessionStorage.setItem('hrc_auth_token', token);
            }

            // Guardar nome do usuário ativo no momento
            localStorage.setItem('current_user', user.name);

            window.location.href = 'index.html';
        } else {
            errorAlert.style.display = 'block';
            setTimeout(() => {
                errorAlert.style.display = 'none';
            }, 3000);
        }
    });
});
