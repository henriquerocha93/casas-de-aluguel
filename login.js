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

// Verifica se o Supabase está configurado e retorna o client
function getSupabaseClient() {
    const url = localStorage.getItem('hrc_supabase_url');
    const key = localStorage.getItem('hrc_supabase_key');
    if (url && key && typeof supabase !== 'undefined' && supabase.createClient) {
        try {
            return supabase.createClient(url, key);
        } catch (e) {
            console.warn('Falha ao criar cliente Supabase no login:', e);
            return null;
        }
    }
    return null;
}

// Tenta autenticar via Supabase, retorna o user ou null
async function authenticateCloud(username, password) {
    const sb = getSupabaseClient();
    if (!sb) return null;

    try {
        const { data, error } = await sb
            .from('lumina_users')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !data) return null;

        if (data.password === password) {
            return {
                id: data.id,
                username: data.username,
                password: data.password,
                name: data.name
            };
        }
        return null;
    } catch (e) {
        console.warn('Erro na autenticação cloud:', e);
        return null;
    }
}

// Autentica localmente (fallback)
function authenticateLocal(username, password) {
    const users = JSON.parse(localStorage.getItem('hrc_users')) || [];
    return users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password) || null;
}

// Lógica de login
document.addEventListener('DOMContentLoaded', () => {
    initUsers();
    
    // Se já estiver autenticado e o "Lembrar-me" foi usado, pula pro index
    if (localStorage.getItem('hrc_auth_token')) {
        window.location.href = 'index.html';
        return;
    }

    const loginForm = document.getElementById('login-form');
    const errorAlert = document.getElementById('error-alert');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const userVal = document.getElementById('username').value.trim();
        const passVal = document.getElementById('password').value;
        const remember = document.getElementById('remember-me').checked;

        // Desabilita o botão enquanto tenta login
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Autenticando...';

        let user = null;

        // 1. Tenta autenticar na nuvem (se configurada)
        user = await authenticateCloud(userVal, passVal);

        // 2. Fallback local
        if (!user) {
            user = authenticateLocal(userVal, passVal);
        }

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
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
            errorAlert.style.display = 'block';
            setTimeout(() => {
                errorAlert.style.display = 'none';
            }, 3000);
        }
    });
});
