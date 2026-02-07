// Type-C Messenger - Matrix Protocol Integration
// ================================================

class TypeCMessenger {
    constructor() {
        this.client = null;
        this.currentRoomId = null;
        this.rooms = new Map();
        this.currentTab = 'dms';
        this.searchDebounceTimer = null;
        this.recentRooms = []; // Last 5 active rooms
        this.summaryInterval = null;
        this.holidays = {}; // Holiday data from ICS
        this.quotes = []; // Daily quotes
        this.currentCalendarMonth = new Date().getMonth();
        this.currentCalendarYear = new Date().getFullYear();

        // Passcode State
        this.passcode = localStorage.getItem('app_passcode') || null;
        this.currentPasscodeInput = '';
        this.isPasscodeSetupMode = false;
        this.tempPasscode = null; // For confirmation during setup

        window.messenger = this;
        window.MessengerDebug = {
            getStatus: () => ({
                secureContext: window.isSecureContext,
                subtleCrypto: !!(window.crypto && window.crypto.subtle),
                olmLoaded: !!window.Olm,
                olmReady: !!window.OlmReady,
                cryptoEnabled: this.client ? this.client.isCryptoEnabled() : 'no-client',
                deviceId: this.client ? this.client.deviceId : 'none'
            })
        };

        this.init();
    }

    async init() {
        // Initialize Olm (E2EE dependency)
        console.group('[CRYPTO DIAGNOSTICS]');
        console.log('Secure Context:', window.isSecureContext);
        console.log('Subtle Crypto:', !!(window.crypto && window.crypto.subtle));
        console.log('IndexedDB:', !!window.indexedDB);
        console.log('Olm library loaded:', !!window.Olm);
        if (window.Olm) {
            console.log('Olm version hint:', typeof window.Olm.init);
        }
        console.groupEnd();

        if (window.Olm && typeof window.Olm.init === 'function') {
            try {
                await window.Olm.init();
                console.log('%c [CRYPTO] Olm initialized successfully', 'color: #00ffff; font-weight: bold;');
                // Global handle for matrix tools
                window.OlmReady = true;
            } catch (e) {
                console.error('[CRYPTO] Failed to initialize Olm:', e);
                window.OlmReady = false;
            }
        } else {
            console.warn('[CRYPTO] Olm library not found or invalid! E2EE will be disabled.');
            window.OlmReady = false;
        }

        // Load theme from localStorage
        const savedTheme = localStorage.getItem('matrix_theme') || 'green';
        this.setTheme(savedTheme);

        // Initialize Matrix Rain state
        const isRainEnabled = localStorage.getItem('matrix_rain_enabled') !== 'false';
        const rainCanvas = document.getElementById('matrix-rain');
        if (rainCanvas) {
            rainCanvas.style.display = isRainEnabled ? 'block' : 'none';
        }

        // Request notification permission
        this.requestNotificationPermission();

        // Check if Matrix SDK is loaded
        if (typeof window.matrixcs === 'undefined') {
            const errorDiv = document.getElementById('login-error');
            if (errorDiv) {
                errorDiv.textContent = 'Ошибка: SDK Matrix не загружен. Проверьте соединение.';
                errorDiv.classList.add('show');
            }
            console.error('Matrix SDK not loaded. Please check your internet connection.');
            return;
        }

        // Check for existing session
        const accessToken = localStorage.getItem('matrix_access_token');
        const userId = localStorage.getItem('matrix_user_id');
        const homeserver = localStorage.getItem('matrix_homeserver');
        const deviceId = localStorage.getItem('matrix_device_id');

        if (accessToken && userId && homeserver) {
            this.autoLogin(homeserver, accessToken, userId, deviceId);
            // Refresh display info after login
            setTimeout(() => this.updateUserDisplay(), 2000);
        } else {
            this.showLoginScreen();
        }

        this.loadHolidays();
        this.loadQuotes();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // ... previous listeners ...

        // Mobile Back Button
        const backBtn = document.getElementById('back-to-rooms-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                document.querySelector('.chat-container').classList.remove('chat-active');
                // Optional: Clear selection visually if needed, but keeping state is usually better
            });
        }

        // Auth form (Login/Register)
        document.getElementById('auth-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAuth();
        });
        // ... rest of start of setupEventListeners ...

        // Auth Tabs
        document.querySelectorAll('.auth-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchAuthTab(btn.dataset.tab);
            });
        });

        // Logout button
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Message form
        document.getElementById('message-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSendMessage();
        });



        // Main Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // Action buttons
        document.getElementById('new-dm-btn').addEventListener('click', () => {
            this.isSettingUpEncryptedDM = false;
            this.openModal('new-dm-modal');
        });

        document.getElementById('new-encrypted-dm-btn').addEventListener('click', () => {
            this.isSettingUpEncryptedDM = true;
            this.openModal('new-dm-modal');
        });

        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.openModal('create-room-modal');
        });

        // Search removed
        /* 
        document.getElementById('join-room-btn')?.addEventListener('click', () => {
            this.openModal('join-room-modal');
        });
        */

        // Modal close buttons and overlays
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeModal(btn.dataset.modal);
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                this.closeAllModals();
            });
        });

        // User search (for DMs)
        const userSearchInput = document.getElementById('user-search-input');
        if (userSearchInput) {
            userSearchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.searchUsers(e.target.value);
                }, 500);
            });
        }

        // Create room form
        const createRoomForm = document.getElementById('create-room-form');
        if (createRoomForm) {
            createRoomForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleCreateRoom();
            });
        }

        // File Attachment
        const fileInput = document.getElementById('file-input');
        const attachBtn = document.getElementById('attach-btn');

        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', (e) => {
                this.handleFileUpload(e);
            });
        }

        // Room Settings & Actions
        const settingsBtn = document.getElementById('room-settings-btn');
        const settingsMenu = document.getElementById('room-settings-menu');
        const leaveBtn = document.getElementById('leave-room-btn');
        const inviteBtn = document.getElementById('invite-user-btn');

        if (settingsBtn && settingsMenu) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', () => {
                if (!settingsMenu.classList.contains('hidden')) {
                    settingsMenu.classList.add('hidden');
                }
            });
        }

        if (leaveBtn) {
            leaveBtn.addEventListener('click', () => {
                this.leaveCurrentRoom();
            });
        }

        if (inviteBtn) {
            inviteBtn.addEventListener('click', () => {
                this.openModal('invite-user-modal');
            });
        }

        const viewMembersBtn = document.getElementById('view-members-btn');
        if (viewMembersBtn) {
            viewMembersBtn.addEventListener('click', () => {
                this.openMembersModal();
            });
        }

        const memberSearchInput = document.getElementById('member-search-input');
        if (memberSearchInput) {
            memberSearchInput.addEventListener('input', (e) => {
                this.filterMembers(e.target.value);
            });
        }

        // Profile Modal

        const sidebarSettingsBtn = document.getElementById('sidebar-settings-btn');
        if (sidebarSettingsBtn) {
            sidebarSettingsBtn.addEventListener('click', () => {
                this.openAppSettingsModal();
            });
        }

        const profileSettingsBtn = document.getElementById('profile-settings-btn');
        if (profileSettingsBtn) {
            profileSettingsBtn.addEventListener('click', () => {
                this.openProfileModal();
            });
        }

        // Matrix Rain Button
        const matrixRainBtn = document.getElementById('matrix-rain-btn');
        if (matrixRainBtn) {
            // Initialize button state from localStorage
            const isEnabled = localStorage.getItem('matrix_rain_enabled') !== 'false';
            matrixRainBtn.textContent = isEnabled ? 'ВКЛ' : 'ВЫКЛ';
            matrixRainBtn.classList.toggle('active', isEnabled);

            matrixRainBtn.addEventListener('click', () => {
                const currentlyEnabled = localStorage.getItem('matrix_rain_enabled') !== 'false';
                const newState = !currentlyEnabled;
                this.toggleMatrixRain(newState);
                matrixRainBtn.textContent = newState ? 'ВКЛ' : 'ВЫКЛ';
                matrixRainBtn.classList.toggle('active', newState);
            });
        }

        const summaryBtn = document.getElementById('sidebar-summary-btn');
        const headerSummaryBtn = document.getElementById('header-summary-btn');

        if (summaryBtn) {
            summaryBtn.addEventListener('click', () => {
                this.openSummaryModal();
            });
        }

        if (headerSummaryBtn) {
            headerSummaryBtn.addEventListener('click', () => {
                this.openSummaryModal();
            });
        }

        const saveProfileBtn = document.getElementById('save-profile-btn');
        if (saveProfileBtn) {
            saveProfileBtn.addEventListener('click', () => {
                this.handleProfileUpdate();
            });
        }

        const closeProfileModalBtn = document.getElementById('close-profile-modal');
        if (closeProfileModalBtn) {
            closeProfileModalBtn.addEventListener('click', () => {
                this.closeModal('profile-modal');
            });
        }

        const avatarUpload = document.getElementById('avatar-upload');
        if (avatarUpload) {
            avatarUpload.addEventListener('change', (e) => {
                this.handleAvatarPreview(e);
            });
        }

        // Invite user form
        const inviteForm = document.getElementById('invite-user-form');
        if (inviteForm) {
            inviteForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleInviteUser();
            });
        }

        // Theme Swatches
        document.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                this.setTheme(swatch.dataset.theme);
            });
        });

        // Sidebar Action Buttons Toggle
        const toggleActionsBtn = document.getElementById('toggle-actions-btn');
        if (toggleActionsBtn) {
            toggleActionsBtn.addEventListener('click', () => {
                this.toggleActionButtons();
            });

            // Restore state
            const isCollapsed = localStorage.getItem('sidebar_actions_collapsed') === 'true';
            if (isCollapsed) {
                this.toggleActionButtons(true);
            }
        }

        // --- Passcode Listeners ---
        const lockToggle = document.getElementById('app-lock-toggle');
        if (lockToggle) {
            lockToggle.addEventListener('change', (e) => {
                e.preventDefault(); // Prevent immediate toggle
                if (e.target.checked) {
                    // Start Setup
                    this.startPasscodeSetup();
                    e.target.checked = false; // visual reset until confirmed
                } else {
                    // Disable
                    this.disablePasscode();
                    e.target.checked = true; // visual reset until confirmed
                }
            });
        }

        document.querySelectorAll('.passcode-keypad .key').forEach(key => {
            key.addEventListener('click', (e) => {
                const btn = e.target.closest('.key');
                if (!btn) return;

                const val = btn.dataset.key;
                if (!val) return; // empty key

                if (val === 'delete') {
                    this.handlePasscodeDelete();
                } else {
                    this.handlePasscodeInput(val);
                }
            });
        });

        const cancelPasscodeBtn = document.getElementById('passcode-cancel-btn');
        if (cancelPasscodeBtn) {
            cancelPasscodeBtn.addEventListener('click', () => {
                this.cancelPasscodeSetup();
            });
        }
    }

    toggleActionButtons(forceState) {
        const container = document.getElementById('action-buttons-container');
        const header = document.getElementById('toggle-actions-btn');
        if (!container || !header) return;

        const isCollapsed = forceState !== undefined ? forceState : !container.classList.contains('collapsed');

        container.classList.toggle('collapsed', isCollapsed);
        header.classList.toggle('collapsed', isCollapsed);

        localStorage.setItem('sidebar_actions_collapsed', isCollapsed);
    }

    switchAuthTab(tab) {
        // UI Updates
        document.querySelectorAll('.auth-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        const authBtn = document.getElementById('auth-btn');
        const confirmPassGroup = document.getElementById('confirm-password-group');
        const emailGroup = document.getElementById('email-group');

        if (tab === 'register') {
            authBtn.innerHTML = '<span>Зарегистрироваться</span>';
            confirmPassGroup.classList.remove('hidden');
            emailGroup.classList.remove('hidden');
            // Add required attribute for registration
            document.getElementById('confirm-password').setAttribute('required', 'true');
        } else {
            authBtn.innerHTML = '<span>Войти</span>';
            confirmPassGroup.classList.add('hidden');
            emailGroup.classList.add('hidden');
            document.getElementById('confirm-password').removeAttribute('required');
        }

        // Clear errors
        document.getElementById('auth-error').classList.remove('show');
    }

    async handleAuth() {
        const activeTab = document.querySelector('.auth-tab.active').dataset.tab;

        if (activeTab === 'register') {
            await this.handleRegister();
        } else {
            await this.handleLogin();
        }
    }

    async handleRegister() {
        const homeserver = 'https://type-c-kmr.duckdns.org/';
        const usernameInput = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const email = document.getElementById('email').value.trim();

        const authBtn = document.getElementById('auth-btn');
        const errorDiv = document.getElementById('auth-error');

        // Clear previous errors
        errorDiv.classList.remove('show');
        errorDiv.textContent = '';

        if (password !== confirmPassword) {
            errorDiv.textContent = 'Пароли не совпадают';
            errorDiv.classList.add('show');
            return;
        }

        // Disable button
        authBtn.disabled = true;
        authBtn.innerHTML = '<span>Регистрация...</span>';

        try {
            console.log('Connecting to homeserver:', homeserver);

            // Create client for registration
            const regClient = window.matrixcs.createClient({
                baseUrl: homeserver,
                fetchFn: window.fetch.bind(window)
            });

            // Extract localpart for proper registration
            // The register method expects just the username part if it's not a full ID match flow,
            // but providing just the localpart is safer for generic registration.
            let localpart = usernameInput;
            if (localpart.startsWith('@')) localpart = localpart.substring(1);
            if (localpart.includes(':')) localpart = localpart.split(':')[0];

            console.log('Registering with localpart:', localpart);

            const result = await regClient.register(
                localpart,
                password,
                null, // session
                { type: 'm.login.dummy' }, // auth object - CRITICAL for simple registration
                { email: email || undefined } // bindEmail/extra content
            );

            console.log('Registration successful:', result);

            // Auto-login after registration
            await this.handleLogin(homeserver, result.user_id, result.access_token, result.device_id);

        } catch (error) {
            console.error('Registration error:', error);

            let errorMessage = 'Ошибка регистрации: ';
            if (error.errcode === 'M_USER_IN_USE') {
                errorMessage += 'Пользователь с таким именем уже существует';
            } else if (error.errcode === 'M_WEAK_PASSWORD') {
                errorMessage += 'Пароль слишком простой';
            } else if (error.errcode === 'M_INVALID_USERNAME') {
                errorMessage += 'Недопустимое имя пользователя';
            } else if (error.message) {
                if (error.message.includes('401') || error.message.includes('Unknown message')) {
                    errorMessage += 'Ошибка протокола (401). Возможно сервер требует капчу или подтверждение email, которое пока не поддерживается.';
                } else if (error.message.includes('User ID can only contain')) {
                    errorMessage += 'Имя может содержать только латинские буквы (a-z) и цифры.';
                } else {
                    errorMessage += error.message;
                }
            } else {
                errorMessage += 'Неизвестная ошибка';
            }

            errorDiv.textContent = errorMessage;
            errorDiv.classList.add('show');
            authBtn.disabled = false;
            authBtn.innerHTML = '<span>Зарегистрироваться</span>';
        }
    }

    async handleLogin(forceHomeserver, forceUserId, forceAccessToken, forceDeviceId) {
        const homeserver = forceHomeserver || 'https://type-c-kmr.duckdns.org/';
        const username = forceUserId || document.getElementById('username').value.trim();
        const password = forceAccessToken ? null : document.getElementById('password').value;

        const authBtn = document.getElementById('auth-btn');
        const errorDiv = document.getElementById('auth-error');

        // Clear previous errors
        errorDiv.classList.remove('show');
        errorDiv.textContent = '';

        // Disable button during login
        authBtn.disabled = true;
        authBtn.innerHTML = '<span>Подключение...</span>';

        try {
            console.log('Attempting to connect to homeserver:', homeserver);

            let accessToken = forceAccessToken;
            let userId = forceUserId;
            let response = null;
            let deviceId = forceDeviceId || localStorage.getItem('matrix_device_id');

            if (!accessToken) {
                // Create Matrix client
                this.client = window.matrixcs.createClient({
                    baseUrl: homeserver,
                    fetchFn: window.fetch.bind(window)
                });

                // Login
                response = await this.client.loginWithPassword(username, password);
                console.log('Login successful:', response);

                accessToken = response.access_token;
                userId = response.user_id;

                if (response.device_id) {
                    deviceId = response.device_id;
                    localStorage.setItem('matrix_device_id', deviceId);
                } else {
                    // Fallback to random ID if server didn't provide one (unlikely but safe)
                    deviceId = 'DEVICE_' + Math.random().toString(36).substring(2, 10);
                    localStorage.setItem('matrix_device_id', deviceId);
                }
            }

            if (!deviceId) {
                deviceId = localStorage.getItem('matrix_device_id') || ('DEVICE_' + Math.random().toString(36).substring(2, 10));
                localStorage.setItem('matrix_device_id', deviceId);
            }

            // Store credentials
            localStorage.setItem('matrix_access_token', accessToken);
            localStorage.setItem('matrix_user_id', userId);
            localStorage.setItem('matrix_homeserver', homeserver);

            console.log('%c [AUTH] Reinitializing client for E2EE with DeviceId:', 'color: #00ff00;', deviceId);

            // Reinitialize client with access token and deviceId
            let cryptoStore;
            try {
                cryptoStore = new window.matrixcs.IndexedDBCryptoStore(window.indexedDB, "matrix-js-sdk-crypto");
                console.log('%c [CRYPTO] Using IndexedDBCryptoStore', 'color: #00ffff;');
            } catch (e) {
                console.warn('[CRYPTO] IndexedDB not available, falling back to MemoryStore:', e);
                cryptoStore = new window.matrixcs.MemoryCryptoStore();
            }

            try {
                this.client = window.matrixcs.createClient({
                    baseUrl: homeserver,
                    accessToken: accessToken,
                    userId: userId,
                    deviceId: deviceId,
                    cryptoStore: cryptoStore,
                    fetchFn: window.fetch.bind(window)
                });

                await this.startClient();
            } catch (cryptoErr) {
                console.error('[CRYPTO] Failed to start client with encryption:', cryptoErr);
                if (cryptoErr.message && cryptoErr.message.toLowerCase().includes('encryption')) {
                    console.warn('[CRYPTO] Falling back to NON-ENCRYPTED client flow.');

                    this.client = window.matrixcs.createClient({
                        baseUrl: homeserver,
                        accessToken: accessToken,
                        userId: userId,
                        fetchFn: window.fetch.bind(window)
                    });

                    await this.startClient();
                } else {
                    throw cryptoErr; // Rethrow if it's not a crypto-related error
                }
            }

        } catch (error) {
            console.error('Login error:', error);

            // Detailed error message
            let errorMessage = 'Ошибка входа: ';

            if (error.message && error.message.includes('fetch failed')) {
                errorMessage += 'Не удалось подключиться к серверу Type-C. Проверьте:\n' +
                    '• Подключение к интернету\n' +
                    '• Доступность ' + homeserver;
            } else if (error.errcode === 'M_FORBIDDEN') {
                errorMessage += 'Неверное имя пользователя или пароль';
            } else if (error.errcode === 'M_USER_DEACTIVATED') {
                errorMessage += 'Пользователь деактивирован';
            } else if (error.errcode === 'M_LIMIT_EXCEEDED') {
                errorMessage += 'Слишком много попыток входа. Подождите немного.';
            } else if (error.data && error.data.error) {
                errorMessage += error.data.error;
            } else if (error.message) {
                errorMessage += error.message;
            } else {
                errorMessage += 'Неизвестная ошибка';
            }

            errorDiv.textContent = errorMessage;
            errorDiv.classList.add('show');
            authBtn.disabled = false;
            authBtn.innerHTML = '<span>Войти</span>';
        }
    }

    async autoLogin(homeserver, accessToken, userId, deviceId) {
        try {
            // Ensure deviceId exists
            if (!deviceId) {
                deviceId = localStorage.getItem('matrix_device_id') || ('DEVICE_' + Math.random().toString(36).substring(2, 10));
                localStorage.setItem('matrix_device_id', deviceId);
            }

            console.log('%c [AUTH] Auto-login with DeviceId:', 'color: #00ff00;', deviceId);

            let cryptoStore;
            try {
                // Check if IndexedDB is actually supported before trying to use it
                if (window.indexedDB) {
                    cryptoStore = new window.matrixcs.IndexedDBCryptoStore(window.indexedDB, "matrix-js-sdk-crypto");
                    console.log('%c [CRYPTO] Using IndexedDBCryptoStore', 'color: #00ffff;');
                } else {
                    throw new Error("IndexedDB not supported");
                }
            } catch (e) {
                console.warn('[CRYPTO] IndexedDB not available, falling back to MemoryStore:', e);
                cryptoStore = new window.matrixcs.MemoryCryptoStore();
            }

            try {
                this.client = window.matrixcs.createClient({
                    baseUrl: homeserver,
                    accessToken: accessToken,
                    userId: userId,
                    deviceId: deviceId, // Pass the deviceId!
                    cryptoStore: cryptoStore,
                    fetchFn: window.fetch.bind(window)
                });

                await this.startClient();
            } catch (cryptoErr) {
                console.error('[CRYPTO] Auto-login failed with encryption:', cryptoErr);
                if (cryptoErr.message && cryptoErr.message.toLowerCase().includes('encryption')) {
                    console.warn('[CRYPTO] Falling back to NON-ENCRYPTED auto-login flow.');

                    this.client = window.matrixcs.createClient({
                        baseUrl: homeserver,
                        accessToken: accessToken,
                        userId: userId,
                        fetchFn: window.fetch.bind(window)
                    });

                    await this.startClient();
                } else {
                    throw cryptoErr;
                }
            }

        } catch (error) {
            console.error('Auto-login failed:', error);
            this.handleLogout();
        }
    }

    async startClient() {
        // Initialize Crypto (E2EE)
        try {
            // Only attempt crypto if we have a deviceId (Legacy Mode clients don't have it)
            if (this.client.deviceId && typeof this.client.initCrypto === 'function') {
                console.log('%c [CRYPTO] Initializing E2EE...', 'color: #00ffff; font-weight: bold;');

                // Ensure Olm is ready
                if (!window.OlmReady && window.Olm) {
                    console.warn('[CRYPTO] Olm late init...');
                    try { await window.Olm.init(); window.OlmReady = true; } catch (e) { console.error(e); }
                }

                // Set a timeout or catch specific failure to avoid hanging
                try {
                    await this.client.initCrypto();
                } catch (initErr) {
                    console.error('[CRYPTO] initCrypto failed:', initErr);

                    // Specific handling for hard-disabled state
                    const isHardDisabled = initErr.message && (
                        initErr.message.toLowerCase().includes('disabled') ||
                        initErr.message.toLowerCase().includes('olm') ||
                        initErr.message.toLowerCase().includes('crypto')
                    );

                    if (isHardDisabled) {
                        console.warn('[CRYPTO] E2EE is blocked by the SDK. RESTARTING IN LEGACY MODE...');

                        const homeserver = this.client.baseUrl;
                        const accessToken = this.client.getAccessToken();
                        const userId = this.client.getUserId();

                        // Re-create WITHOUT deviceId/cryptoStore to avoid the block
                        this.client = window.matrixcs.createClient({
                            baseUrl: homeserver,
                            accessToken: accessToken,
                            userId: userId,
                            fetchFn: window.fetch.bind(window)
                        });

                        // Set global for debugging
                        window.messenger.client = this.client;

                        return this.startClient();
                    }
                }

                const isEnabled = this.client.isCryptoEnabled();
                console.log('%c [CRYPTO] E2EE Status check. Enabled:',
                    isEnabled ? 'color: #00ff00; font-weight: bold;' : 'color: #ff0000; font-weight: bold;',
                    isEnabled);

                if (isEnabled) {
                    // v1861 fix: Allow sending messages to unverified devices
                    if (this.client.setGlobalErrorOnUnknownDevices) {
                        this.client.setGlobalErrorOnUnknownDevices(false);
                    }
                }
            }
        } catch (e) {
            console.error('[CRYPTO] Fatal error during E2EE setup:', e);
        }

        // Setup event handlers
        // v208: Moving listeners OUTSIDE sync to avoid redundant attachments
        // and using a guard to be absolutely sure
        if (this.client._listenersAttached) {
            console.log('[DEBUG] Listeners already attached to this client instance, skipping.');
        } else {
            console.log('[DEBUG] Attaching Room.timeline and Event.decrypted listeners.');

            // Listen for new messages (both decrypted and encrypted)
            this.client.on('Room.timeline', (event, room, toStartOfTimeline) => {
                if (toStartOfTimeline) return;

                const type = event.getType();
                if (type !== 'm.room.message' && type !== 'm.room.encrypted') return;

                const roomId = event.getRoomId();

                // Audio or Notification
                this.showNotification(event, room);

                // If encrypted and failed to decrypt, request keys
                if (type === 'm.room.encrypted' && event.isDecryptionFailure()) {
                    console.log('%c [CRYPTO] Requesting missing keys for event:', 'color: #ff9900;', event.getId());
                }

                if (roomId === this.currentRoomId) {
                    this.addMessageToTimeline(event);
                    this.markAsRead(roomId);
                }

                // Update room list preview
                this.loadRooms();
            });

            // Listen for successful decryption
            this.client.on('Event.decrypted', (event) => {
                const roomId = event.getRoomId();
                if (roomId === this.currentRoomId) {
                    // Update only this specific message instead of reloading all
                    this.addMessageToTimeline(event);
                }
            });

            this.client._listenersAttached = true;
        }

        this.client.on('sync', (state, prevState, data) => {
            console.log('Sync state:', state);
            this.updateConnectionStatus(state);
            if (state === 'PREPARED') {
                this.onSyncComplete();
                this.showChatScreen();
            }
        });

        // Start syncing
        try {
            await this.client.startClient({ initialSyncLimit: 20 });
        } catch (e) {
            console.error('Failed to start client:', e);
            this.updateConnectionStatus('ERROR');
        }
    }

    updateConnectionStatus(state) {
        const el = document.getElementById('connection-status');
        if (!el) return;

        const text = el.querySelector('.status-text');
        el.className = 'connection-status'; // reset

        switch (state) {
            case 'PREPARED':
            case 'SYNCING':
                el.classList.add('online');
                text.textContent = 'В сети';
                break;
            case 'RECONNECTING':
                el.classList.add('connecting');
                text.textContent = 'Переподключение...';
                break;
            case 'ERROR':
                el.classList.add('error');
                text.textContent = 'Ошибка сети';
                break;
            default:
                el.classList.add('connecting');
                text.textContent = 'Синхронизация...';
        }
    }

    onSyncComplete() {
        console.log('Sync complete');

        // Update user info
        const userId = this.client.getUserId();
        const user = this.client.getUser(userId);
        const displayName = user?.displayName || userId.split(':')[0].substring(1);

        document.getElementById('user-display-name').textContent = displayName;
        document.getElementById('user-id').textContent = userId;
        document.getElementById('user-avatar').textContent = this.getInitials(displayName);

        // Load rooms
        this.loadRooms();
    }

    loadRooms() {
        if (!this.client) return;

        // Filter out rooms where user has left or been banned
        const rawRooms = this.client.getRooms();
        if (!rawRooms) return;

        const rooms = rawRooms.filter(r => {
            try {
                const membership = r.getMyMembership();
                return membership === 'join' || membership === 'invite';
            } catch (e) {
                return false;
            }
        });
        const roomsList = document.getElementById('rooms-list');
        if (!roomsList) return;

        roomsList.innerHTML = '';

        // Filter rooms by current tab
        const filteredRooms = rooms.filter(room => {
            if (this.currentTab === 'dms') {
                return this.isDMRoom(room);
            } else {
                return !this.isDMRoom(room);
            }
        });

        if (filteredRooms.length === 0) {
            const message = this.currentTab === 'dms'
                ? 'У вас пока нет личных сообщений'
                : 'У вас пока нет комнат';
            roomsList.innerHTML = `
                <div class="loading-rooms">
                    <p>${message}</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();
        filteredRooms.forEach(room => {
            try {
                const roomId = room.roomId;
                let roomName = room.name || room.getCanonicalAlias() || 'Безымянная комната';

                const unreadCount = room.getUnreadNotificationCount('total');
                const isInvited = room.getMyMembership() === 'invite';

                if (this.isDMRoom(room) && (!room.name || room.name.trim() === '')) {
                    const members = typeof room.getJoinedMembers === 'function' ? room.getJoinedMembers() : [];
                    const otherMember = members.find(m => m.userId !== this.client.getUserId());
                    if (otherMember) {
                        roomName = otherMember.name || otherMember.userId.split(':')[0].substring(1);
                    }
                }

                const lastMessage = isInvited ? 'Вы приглашены в эту комнату' : this.getLastMessage(room);

                this.rooms.set(roomId, {
                    name: roomName,
                    room: room
                });

                const roomElement = document.createElement('div');
                // Use String comparison to be absolutely sure
                const isActive = String(roomId) === String(this.currentRoomId);
                roomElement.className = `room-item ${isActive ? 'active' : ''} ${unreadCount > 0 ? 'unread' : ''}`;
                roomElement.dataset.roomId = roomId;

                // Don't show badge if it's the current active room
                const shouldShowBadge = unreadCount > 0 && !isActive;

                roomElement.innerHTML = `
                    <div class="room-item-content">
                        <h4>${this.escapeHtml(roomName)}</h4>
                        <p>${this.escapeHtml(lastMessage)}</p>
                    </div>
                    ${shouldShowBadge ? `<span class="unread-badge-sidebar">${unreadCount}</span>` : ''}
                `;

                roomElement.addEventListener('click', () => {
                    this.selectRoom(roomId);
                });

                fragment.appendChild(roomElement);
            } catch (e) {
                console.error('[UI] Failed to render room item:', e);
            }
        });

        roomsList.innerHTML = ''; // Final clear just before append
        roomsList.appendChild(fragment);
    }

    getLastMessage(room) {
        const timeline = room.timeline;
        if (!timeline || timeline.length === 0) return 'Нет сообщений';

        for (let i = timeline.length - 1; i >= 0; i--) {
            const event = timeline[i];
            if (event.getType() === 'm.room.message') {
                const content = event.getContent();
                return content.body || 'Сообщение';
            } else if (event.getType() === 'm.room.encrypted') {
                return event.getContent().body || '🔒 [Зашифровано]';
            }
        }

        return 'Нет сообщений';
    }

    selectRoom(roomId) {
        try {
            this.currentRoomId = roomId;
            this.trackRecentRoom(roomId);
            const roomData = this.rooms.get(roomId);

            if (!roomData) return;

            // Update UI
            document.querySelectorAll('.room-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-room-id="${roomId}"]`)?.classList.add('active');

            // Mobile: Show chat screen
            document.querySelector('.chat-container').classList.add('chat-active');

            // Update chat header
            const room = roomData.room;
            const isEncrypted = room && room.currentState.getStateEvents('m.room.encryption', '');
            const cryptoEnabled = this.client.isCryptoEnabled();
            const headerName = document.getElementById('current-room-name');

            headerName.textContent = (isEncrypted ? (cryptoEnabled ? '🔒 ' : '❌🔒 ') : '') + roomData.name;
            headerName.title = isEncrypted ? (cryptoEnabled ? 'Зашифровано' : 'Шифрование заблокировано браузером (нужен localhost)') : 'Обычный чат';

            const memberCount = room.getJoinedMemberCount();
            const membersElements = document.getElementById('room-members-count');

            if (this.isDMRoom(room)) {
                // Find the other user
                const myUserId = this.client.getUserId();
                const members = room.getJoinedMembers();
                const otherMember = members.find(m => m.userId !== myUserId);

                if (otherMember) {
                    const user = this.client.getUser(otherMember.userId);
                    const presence = user ? user.presence : 'offline';
                    const statusText = (presence === 'online' ? 'В сети' : 'Не в сети') + (isEncrypted && !cryptoEnabled ? ' • ⚠️ Шифрование недоступно' : '');
                    membersElements.textContent = statusText;
                    membersElements.className = presence === 'online' ? 'status-online' : 'status-offline';
                    membersElements.style.color = presence === 'online' ? 'var(--color-online)' : 'var(--color-text-secondary)';
                } else {
                    membersElements.textContent = (room.getInvitedMemberCount() > 0 ? 'Ожидание...' : 'Только вы') + (isEncrypted && !cryptoEnabled ? ' • ⚠️ Шифрование недоступно' : '');
                    membersElements.style.color = 'var(--color-text-secondary)';
                }
            } else {
                membersElements.textContent = `${memberCount} участников` + (isEncrypted && !cryptoEnabled ? ' • ⚠️ Шифрование недоступно' : '');
                membersElements.style.color = 'var(--color-text-secondary)';
            }

            // UI Elements
            const messageInput = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');
            const attachBtn = document.getElementById('attach-btn');
            const settingsBtn = document.getElementById('room-settings-btn');

            // Enable message input for all rooms (E2EE now supported)
            messageInput.disabled = false;
            messageInput.placeholder = "Написать сообщение...";
            sendBtn.disabled = false;
            attachBtn.disabled = false;
            settingsBtn.style.display = 'flex';

            // Check permissions and room type for management buttons
            try {
                const isDM = this.isDMRoom(room);
                const myUserId = this.client.getUserId();
                const state = room.getLiveTimeline().getState(matrixcs.EventTimeline.FORWARDS);

                // Invite: Only in group rooms + permission
                const canInvite = !isDM && (state && typeof state.canInvite === 'function') ? state.canInvite(myUserId) : false;
                const inviteUserBtn = document.getElementById('invite-user-btn');
                if (inviteUserBtn) {
                    inviteUserBtn.style.display = canInvite ? 'block' : 'none';
                }

                // Members list: Only in group rooms
                const viewMembersBtn = document.getElementById('view-members-btn');
                if (viewMembersBtn) {
                    viewMembersBtn.style.display = isDM ? 'none' : 'block';
                }
            } catch (e) {
                console.warn('Room menu setup failed:', e);
            }

            // Load messages
            this.loadRoomMessages(roomId);

            // Mark as read
            this.markAsRead(roomId);
        } catch (error) {
            console.error('[UI] selectRoom failed:', error);
        }
    }

    loadRoomMessages(roomId) {
        try {
            if (!this.client) return;
            const room = this.client.getRoom(roomId);
            if (!room) {
                console.warn('[UI] loadRoomMessages: room not found', roomId);
                return;
            }

            const messagesContainer = document.getElementById('messages-container');
            if (!messagesContainer) return;

            messagesContainer.innerHTML = '';

            const timeline = room.timeline;
            if (!timeline) return;

            timeline.forEach(event => {
                try {
                    if (event.getType() === 'm.room.message' || event.getType() === 'm.room.encrypted') {
                        this.addMessageToTimeline(event, false);
                    }
                } catch (e) {
                    console.error('[UI] Error rendering timeline event:', e);
                }
            });

            // Scroll to bottom after all messages are added
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } catch (error) {
            console.error('[UI] loadRoomMessages failed:', error);
        }
    }

    addMessageToTimeline(event, scrollToBottom = true) {
        try {
            const eventId = event.getId();
            const transactionId = event.getUnsigned() ? event.getUnsigned().transaction_id : null;

            // v209: Enhanced De-duplication & Update Logic
            // Find existing message by Event ID OR Transaction ID (for local echoes)
            let existing = null;
            if (eventId) existing = document.querySelector(`[data-event-id="${eventId}"]`);
            if (!existing && transactionId) existing = document.querySelector(`[data-txn-id="${transactionId}"]`);

            if (existing) {
                const isPlaceholder = existing.getAttribute('data-placeholder') === 'true';
                const oldId = existing.getAttribute('data-event-id');

                if (oldId === eventId && !isPlaceholder && event.getType() !== 'm.room.encrypted') {
                    return;
                }
                // We will remove it just before appending the new one to avoid flicker
            }

            const content = event.getContent() || {};
            const sender = event.getSender();
            const timestamp = event.getTs();

            const senderName = this.getSenderName(sender);
            let messageBody = content.body || '';

            // If message is still encrypted after initCrypto (could happen for old messages or missing keys)
            if (event.getType() === 'm.room.encrypted') {
                const reason = typeof event.getDecryptionError === 'function' ? event.getDecryptionError() : (event.decryptionFailureReason || 'нет ключей');
                messageBody = `🔒 [Зашифровано: ${reason}]`;

                // Add a small hint to user
                console.warn(`[CRYPTO] Event ${event.getId()} failed to decrypt:`, reason);
            }

            const messagesContainer = document.getElementById('messages-container');
            if (!messagesContainer) return;

            const room = this.client.getRoom(event.getRoomId()); // CRITICAL: Use event's room ID, not currentRoomId
            if (!room) {
                console.warn('[UI] Room not found for event:', event.getRoomId());
                // We can still render, but some info will be missing (like power levels)
            }

            const member = room ? room.getMember(sender) : null;

            // ADMIN Logic: Simplify using built-in SDK power level
            // Note: We skip the "ADMIN" badge in 1:1 rooms (DMs) because usually both users have PL 100 there.
            const isGroupRoom = room && room.getJoinedMemberCount() > 2;
            const isAdmin = !!(isGroupRoom && member && member.powerLevel >= 50);

            // Use raw MXC URL from member events (most reliable for others' avatars)
            // Use raw MXC URL from member events (most reliable for others' avatars)
            let mxcAvatarUrl = member?.user?.avatarUrl;
            if (!mxcAvatarUrl && member?.events?.member) {
                mxcAvatarUrl = member.events.member.getContent().avatar_url;
            }

            const messageElement = document.createElement('div');
            messageElement.className = `message ${isAdmin ? 'admin-message' : ''}`;
            if (eventId) messageElement.setAttribute('data-event-id', eventId);
            if (transactionId) messageElement.setAttribute('data-txn-id', transactionId);

            // Mark as placeholder if it's currently encrypted/undecrypted
            if (event.getType() === 'm.room.encrypted' && event.isDecryptionFailure()) {
                messageElement.setAttribute('data-placeholder', 'true');
            }

            if (isAdmin) {
                console.log(`[ADMIN DEBUG] Room Admin detected: ${sender} (PL: ${member?.powerLevel})`);
            }

            let messageHtml = `<div class="message-body">${this.escapeHtml(messageBody)}</div>`;

            // Handle attachments
            const isImage = content.msgtype === 'm.image' ||
                (content.info && content.info.mimetype && content.info.mimetype.startsWith('image/')) ||
                (content.body && /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(content.body));

            if (isImage && (content.url || (content.file && content.file.url))) {
                const mxcUrl = content.url || content.file.url;
                messageHtml = `
                <div class="message-attachment">
                    <div class="image-loader" data-mxc="${mxcUrl}" data-body="${this.escapeHtml(content.body)}">
                        <div class="loading-placeholder" style="padding: 20px; border: 1px dashed var(--color-border); border-radius: 8px; text-align: center; font-size: 0.8rem;">
                            Загрузка фото...
                        </div>
                    </div>
                </div>`;

                // Trigger load after render
                setTimeout(() => this.loadAuthenticatedImage(mxcUrl, messageElement), 0);
            } else if (content.msgtype === 'm.file' && content.url) {
                const mxcUrl = content.url;
                messageHtml = `
                <div class="message-attachment">
                    <div class="file-loader" data-mxc="${mxcUrl}" data-body="${this.escapeHtml(content.body)}">
                        <a href="#" class="message-file-link loading" style="opacity: 0.6; pointer-events: none;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                                <polyline points="13 2 13 9 20 9"></polyline>
                            </svg>
                            ${this.escapeHtml(content.body)} (Загрузка...)
                        </a>
                    </div>
                </div>`;

                // Trigger setup for file link
                setTimeout(() => this.loadAuthenticatedFile(mxcUrl, messageElement), 0);
            }

            const avatarId = `avatar-${Math.random().toString(36).substr(2, 9)}`;

            let badgeHtml = isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';

            messageElement.innerHTML = `
                <div class="message-avatar" id="${avatarId}">${this.getInitials(senderName)}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-sender">${this.escapeHtml(senderName)}${badgeHtml}</span>
                        <span class="message-time">${this.formatTime(timestamp)}</span>
                    </div>
                    ${messageHtml}
                </div>
            `;

            if (mxcAvatarUrl) {
                setTimeout(() => this.loadAuthenticatedAvatar(mxcAvatarUrl, avatarId), 0);
            }

            // v215: Safe Replace - remove old element only when new one is ready
            if (existing) {
                existing.remove();
            }

            messagesContainer.appendChild(messageElement);

            if (scrollToBottom) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (error) {
            console.error('[UI] addMessageToTimeline failed:', error);
        }
    }

    async handleSendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();

        if (!message || !this.currentRoomId) return;

        this.trackRecentRoom(this.currentRoomId);

        try {
            // Check if room is encrypted
            const room = this.client.getRoom(this.currentRoomId);
            const isEncrypted = room && room.currentState.getStateEvents('m.room.encryption', '');

            if (isEncrypted && !this.client.isCryptoEnabled()) {
                console.error('[CRYPTO] Blocked: Insecure context or missing crypto support.');
                alert('⚠️ ОШИБКА ШИФРОВАНИЯ\n\nЭтот чат защищён (E2EE), но ваш браузер заблокировал функции шифрования.\n\nПРИЧИНА: Браузеры запрещают шифрование при простом открытии файла (file://).\n\nРЕШЕНИЕ: \n1. Запустите мессенджер через локальный сервер (http://localhost).\n2. Или откройте его через любой веб-сервер с поддержкой HTTPS.');
                return;
            }

            // use sendMessage instead of sendEvent for better E2EE handling in SDK
            await this.client.sendMessage(this.currentRoomId, {
                msgtype: 'm.text',
                body: message
            });

            messageInput.value = '';

        } catch (error) {
            console.error('Error sending message:', error);

            let extraInfo = '';
            if (error.message && error.message.includes('encryption')) {
                extraInfo = `\n\n[Debug Info]\nCrypto Enabled: ${this.client.isCryptoEnabled()}\nDeviceId: ${this.client.deviceId}\nRoom Id: ${this.currentRoomId}`;
                console.log('%c [CRYPTO-DEBUG] ' + extraInfo, 'color: #ff9900;');
            }

            alert('Ошибка отправки сообщения: ' + error.message + extraInfo);
        }
    }

    filterRooms(query) {
        const roomItems = document.querySelectorAll('.room-item');
        const lowerQuery = query.toLowerCase();

        roomItems.forEach(item => {
            const roomName = item.querySelector('h4').textContent.toLowerCase();
            if (roomName.includes(lowerQuery)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // ==========================================
    // Tabs and UI Management
    // ==========================================

    switchTab(tab) {
        this.currentTab = tab;

        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Hide all lists/show appropriate one
        const roomsList = document.getElementById('rooms-list');
        const invitesList = document.getElementById('invites-list');

        if (tab === 'invites') {
            roomsList.classList.add('hidden');
            invitesList.classList.remove('hidden');
            this.loadInvites();
        } else {
            roomsList.classList.remove('hidden');
            invitesList.classList.add('hidden');
            this.loadRooms();
        }

        // Show/hide action buttons
        const newDmBtn = document.getElementById('new-dm-btn');
        const newEncryptedDmBtn = document.getElementById('new-encrypted-dm-btn');
        const createRoomBtn = document.getElementById('create-room-btn');

        if (tab === 'dms') {
            if (newDmBtn) newDmBtn.style.display = '';
            if (newEncryptedDmBtn) newEncryptedDmBtn.style.display = '';
            if (createRoomBtn) createRoomBtn.style.display = 'none';
        } else if (tab === 'rooms') {
            if (newDmBtn) newDmBtn.style.display = 'none';
            if (newEncryptedDmBtn) newEncryptedDmBtn.style.display = 'none';
            if (createRoomBtn) createRoomBtn.style.display = '';
        } else {
            // Invites tab - no header buttons
            if (newDmBtn) newDmBtn.style.display = 'none';
            if (newEncryptedDmBtn) newEncryptedDmBtn.style.display = 'none';
            if (createRoomBtn) createRoomBtn.style.display = 'none';
        }
    }

    loadInvites() {
        const invitesList = document.getElementById('invites-list');
        const rooms = this.client.getRooms();

        // Filter for invited rooms
        const invitedRooms = rooms.filter(room => {
            return room.getMyMembership() === 'invite';
        });

        if (invitedRooms.length === 0) {
            invitesList.innerHTML = '<div class="empty-state">Нет приглашений</div>';
            return;
        }

        invitesList.innerHTML = '';
        invitedRooms.forEach(room => {
            const item = document.createElement('div');
            item.className = 'invite-item';

            // Try to find reasonable name or inviter
            let roomName = room.name || 'Приглашение в чат';

            // Get inviter
            const memberEvent = room.currentState.getStateEvents('m.room.member', this.client.getUserId());
            const inviterId = memberEvent ? memberEvent.getSender() : 'Неизвестно';

            item.innerHTML = `
                <div class="invite-info">
                    <h4>${this.escapeHtml(roomName)}</h4>
                    <p>От: ${this.escapeHtml(inviterId)}</p>
                </div>
                <div class="invite-actions">
                    <button class="btn-accept" data-room-id="${room.roomId}">Принять</button>
                    <button class="btn-reject" data-room-id="${room.roomId}">Отклонить</button>
                </div>
            `;

            item.querySelector('.btn-accept').addEventListener('click', (e) => {
                e.preventDefault();
                this.handleJoinInvite(room.roomId);
            });

            item.querySelector('.btn-reject').addEventListener('click', (e) => {
                e.preventDefault();
                this.handleRejectInvite(room.roomId);
            });

            invitesList.appendChild(item);
        });
    }

    async handleJoinInvite(roomId) {
        try {
            await this.client.joinRoom(roomId);
            // Refresh will happen automatically via sync, but we can force UI update
            setTimeout(() => this.loadInvites(), 500);
        } catch (error) {
            console.error('Error joining room:', error);
            alert('Ошибка присоединения: ' + error.message);
        }
    }

    async handleRejectInvite(roomId) {
        try {
            await this.client.leave(roomId);
            setTimeout(() => this.loadInvites(), 500);
        } catch (error) {
            console.error('Error rejecting invite:', error);
            alert('Ошибка отклонения: ' + error.message);
        }
    }

    isDMRoom(room) {
        // 1. Check m.direct account data (Authoritative)
        const dmRooms = this.client.getAccountData('m.direct')?.getContent() || {};
        for (const userId in dmRooms) {
            if (dmRooms[userId].includes(room.roomId)) {
                return true;
            }
        }

        // 2. Heuristics for direct chats (if not in m.direct)
        const joinedMembers = room.getJoinedMemberCount();
        const invitedMembers = room.getInvitedMemberCount();
        const totalMembers = joinedMembers + invitedMembers;

        // DMs usually have 2 members (active) or 1 (if just created/invited)
        // Groups usually have > 2, but small groups can have 2.
        // We rely on empty name or name matching a user pattern.

        if (totalMembers <= 2) {
            // If the room has no explicit name set, it's likely a DM
            // Use room.currentState to safely get state for accurate room naming check
            const nameEvent = room.currentState.getStateEvents('m.room.name', '');

            if (!nameEvent || !nameEvent.getContent().name) {
                return true;
            }
        }

        return false;
    }

    // ==========================================
    // Modal Management
    // ==========================================

    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');

        // Clear search inputs
        if (modalId === 'new-dm-modal') {
            document.getElementById('user-search-input').value = '';
            document.getElementById('user-search-results').innerHTML = '<p class="search-hint">Начните вводить для поиска пользователей</p>';
        } else if (modalId === 'create-room-modal') {
            document.getElementById('create-room-form').reset();
        } else if (modalId === 'invite-user-modal') {
            document.getElementById('invite-user-form').reset();
        }
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }

    // ==========================================
    // User Search and DM Creation
    // ==========================================

    async searchUsers(query) {
        const resultsContainer = document.getElementById('user-search-results');

        if (!query || query.trim().length < 2) {
            resultsContainer.innerHTML = '<p class="search-hint">Начните вводить для поиска пользователей</p>';
            return;
        }

        try {
            const results = await this.client.searchUserDirectory({ term: query, limit: 10 });
            let hasResults = false;

            resultsContainer.innerHTML = '';

            if (results.results.length > 0) {
                hasResults = true;
                results.results.forEach(user => {
                    const userElement = document.createElement('div');
                    userElement.className = 'search-result-item';
                    userElement.innerHTML = `
                        <h4>${this.escapeHtml(user.display_name || user.user_id)}</h4>
                        <p>${this.escapeHtml(user.user_id)}</p>
                    `;

                    userElement.addEventListener('click', () => {
                        this.createDirectMessage(user.user_id, this.isSettingUpEncryptedDM);
                    });

                    resultsContainer.appendChild(userElement);
                });
            }

            // Always offer to start chat with the searched query as a potential username
            // Construct potential full user ID
            let potentialUserId = query.trim();
            if (!potentialUserId.startsWith('@')) potentialUserId = '@' + potentialUserId;
            if (!potentialUserId.includes(':')) potentialUserId = potentialUserId + ':type-c-kmr.duckdns.org';

            // Check if this potential ID is already in the results to avoid duplicates
            const alreadyShown = results.results.some(u => u.user_id === potentialUserId);

            if (!alreadyShown) {
                const manualElement = document.createElement('div');
                manualElement.className = 'search-result-item';
                // Add a visual separator or style if there were other results
                if (hasResults) {
                    manualElement.style.borderTop = '1px solid var(--color-border)';
                }

                manualElement.innerHTML = `
                    <h4 style="color: var(--color-accent-green)">Написать ${this.escapeHtml(potentialUserId)}</h4>
                    <p>Нажмите, чтобы создать чат с этим пользователем</p>
                `;

                manualElement.addEventListener('click', () => {
                    this.createDirectMessage(potentialUserId, this.isSettingUpEncryptedDM);
                });

                resultsContainer.appendChild(manualElement);
                hasResults = true;
            }

            if (!hasResults) {
                resultsContainer.innerHTML = '<p class="search-no-results">Пользователи не найдены</p>';
            }

        } catch (error) {
            console.error('User search error:', error);
            resultsContainer.innerHTML = '<p class="search-no-results">Ошибка поиска пользователей</p>';
        }
    }

    async createDirectMessage(userId, encrypted = false) {
        try {
            // Check if DM already exists
            const existingDM = this.findExistingDM(userId);
            if (existingDM) {
                // If it exists, but we want encrypted and it's not (or vice versa), 
                // we'll still go to it, but warn? Or just create a new one?
                // Standard Matrix behavior is to reuse.
                this.closeModal('new-dm-modal');
                this.selectRoom(existingDM);
                this.switchTab('dms');
                return;
            }

            // Create new DM room
            const roomOptions = {
                visibility: 'private',
                is_direct: true,
                invite: [userId],
                preset: 'trusted_private_chat'
            };

            if (encrypted) {
                roomOptions.initial_state = [
                    {
                        type: 'm.room.encryption',
                        state_key: '',
                        content: {
                            algorithm: 'm.megolm.v1.aes-sha2'
                        }
                    }
                ];
            }

            const result = await this.client.createRoom(roomOptions);

            console.log('DM created:', result.room_id, encrypted ? '(Encrypted)' : '');

            // Mark room as direct
            await this.markRoomAsDirect(result.room_id, userId);

            this.closeModal('new-dm-modal');

            // Wait for sync to get new room
            setTimeout(() => {
                this.loadRooms();
                this.selectRoom(result.room_id);
                this.switchTab('dms');
            }, 1000);

        } catch (error) {
            console.error('Error creating DM:', error);
            alert('Ошибка создания личного сообщения: ' + error.message);
        }
    }

    findExistingDM(userId) {
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            if (this.isDMRoom(room)) {
                const members = room.getJoinedMembers();
                if (members.some(m => m.userId === userId)) {
                    return room.roomId;
                }
            }
        }
        return null;
    }

    async markRoomAsDirect(roomId, userId) {
        try {
            const dmRooms = this.client.getAccountData('m.direct')?.getContent() || {};

            if (!dmRooms[userId]) {
                dmRooms[userId] = [];
            }

            if (!dmRooms[userId].includes(roomId)) {
                dmRooms[userId].push(roomId);
            }

            await this.client.setAccountData('m.direct', dmRooms);
        } catch (error) {
            console.error('Error marking room as direct:', error);
        }
    }

    // ==========================================
    // Room Creation
    // ==========================================

    async handleCreateRoom() {
        const roomName = document.getElementById('room-name').value.trim();
        const roomTopic = document.getElementById('room-topic').value.trim();
        const isPublic = document.getElementById('room-public').checked;

        if (!roomName) {
            alert('Введите название комнаты');
            return;
        }

        try {
            const roomOptions = {
                name: roomName,
                topic: roomTopic,
            };

            if (isPublic) {
                // Public room configuration that other clients can see
                roomOptions.visibility = 'public';
                roomOptions.preset = 'public_chat';
                // Important for visibility in some clients
                roomOptions.initial_state = [
                    {
                        type: 'm.room.join_rules',
                        content: { join_rule: 'public' }
                    },
                    {
                        type: 'm.room.history_visibility',
                        content: { history_visibility: 'world_readable' }
                    }
                ];

                // Set alias based on name (sanitized) to make it findable via alias too
                // This is optional but helpful
                const alias = roomName.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (alias.length > 3) {
                    roomOptions.room_alias_name = alias;
                }
            } else {
                roomOptions.visibility = 'private';
                roomOptions.preset = 'private_chat';
            }

            const result = await this.client.createRoom(roomOptions);

            console.log('Room created:', result.room_id);

            // If public, explicitly ensure it's in the directory (createRoom visibility='public' should do this, but double check)
            if (isPublic) {
                try {
                    await this.client.setRoomDirectoryVisibility(result.room_id, 'public');
                } catch (e) {
                    console.warn('Could not set directory visibility explicitly:', e);
                }
            }

            this.closeModal('create-room-modal');

            // Wait for sync
            setTimeout(() => {
                this.loadRooms();
                this.selectRoom(result.room_id);
                this.switchTab('rooms');
            }, 1000);

        } catch (error) {
            console.error('Error creating room:', error);
            alert('Ошибка создания комнаты: ' + error.message);
        }
    }

    async handleInviteUser() {
        const usernameInput = document.getElementById('invite-username');
        let username = usernameInput.value.trim();

        if (!username) return;

        // Auto-format username
        if (!username.startsWith('@')) username = '@' + username;
        if (!username.includes(':')) username += ':type-c-kmr.duckdns.org';

        if (!this.currentRoomId) return;

        try {
            await this.client.invite(this.currentRoomId, username);
            alert(`Пользователь ${username} приглашен!`);
            this.closeModal('invite-user-modal');
            usernameInput.value = '';
        } catch (error) {
            console.error('Invite error:', error);
            alert('Ошибка приглашения: ' + (error.message || 'Неизвестная ошибка'));
        }
    }

    openMembersModal() {
        if (!this.currentRoomId) return;
        this.openModal('members-modal');
        this.renderMembersList();
    }

    renderMembersList() {
        const room = this.client.getRoom(this.currentRoomId);
        if (!room) return;

        const container = document.getElementById('members-list-container');
        if (!container) return;
        container.innerHTML = '';

        const members = room.getJoinedMembers();
        const myUserId = this.client.getUserId();

        // Get power levels
        const powerLevelsEvent = room.currentState.getStateEvents('m.room.power_levels', '');
        const plContent = powerLevelsEvent ? powerLevelsEvent.getContent() : {};
        const usersPl = plContent.users || {};

        const myPowerLevel = usersPl[myUserId] !== undefined ? usersPl[myUserId] : (plContent.users_default || 0);
        const kickLevel = plContent.kick !== undefined ? plContent.kick : 50;
        const banLevel = plContent.ban !== undefined ? plContent.ban : 50;
        const stateLevel = plContent.state_default !== undefined ? plContent.state_default : 50;

        members.forEach(member => {
            const userPowerLevel = member.powerLevel || 0;
            const role = userPowerLevel >= 100 ? 'Admin' : (userPowerLevel >= 50 ? 'Mod' : 'Member');
            const roleClass = userPowerLevel >= 100 ? 'role-admin' : (userPowerLevel >= 50 ? 'role-mod' : 'role-member');

            const item = document.createElement('div');
            item.className = 'member-item';

            // Actions logic
            let actionsHtml = '';
            if (member.userId !== myUserId) {
                const canKick = myPowerLevel >= kickLevel && myPowerLevel > userPowerLevel;
                const canBan = myPowerLevel >= banLevel && myPowerLevel > userPowerLevel;
                const canPromote = myPowerLevel >= stateLevel && myPowerLevel > userPowerLevel && userPowerLevel < 100;

                if (canKick) {
                    actionsHtml += `<button class="btn-member-action action-danger" data-user-id="${member.userId}" data-action="kick" title="Кикнуть">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>`;
                }
                if (canBan) {
                    actionsHtml += `<button class="btn-member-action action-danger" data-user-id="${member.userId}" data-action="ban" title="Забанить">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                    </button>`;
                }
                if (canPromote) {
                    actionsHtml += `<button class="btn-member-action" data-user-id="${member.userId}" data-action="promote" title="Сделать администратором">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    </button>`;
                }
            }

            item.innerHTML = `
                <div class="member-avatar">${this.getInitials(member.name)}</div>
                <div class="member-info">
                    <div class="member-name-row">
                        <span class="member-name">${this.escapeHtml(member.name)}</span>
                        <span class="role-badge ${roleClass}">${role}</span>
                    </div>
                    <div class="member-id">${member.userId}</div>
                </div>
                <div class="member-actions">${actionsHtml}</div>
            `;

            // Add events to buttons
            item.querySelectorAll('.btn-member-action').forEach(btn => {
                btn.addEventListener('click', () => {
                    const userId = btn.dataset.userId;
                    const action = btn.dataset.action;
                    if (action === 'kick') this.handleKickMember(userId);
                    else if (action === 'ban') this.handleBanMember(userId);
                    else if (action === 'promote') this.handlePromoteMember(userId);
                });
            });

            container.appendChild(item);
        });
    }

    filterMembers(query) {
        const lowerQuery = query.toLowerCase();
        document.querySelectorAll('.member-item').forEach(item => {
            const nameElt = item.querySelector('.member-name');
            const idElt = item.querySelector('.member-id');
            const name = nameElt ? nameElt.textContent.toLowerCase() : '';
            const id = idElt ? idElt.textContent.toLowerCase() : '';
            if (name.includes(lowerQuery) || id.includes(lowerQuery)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    async handleKickMember(userId) {
        if (!confirm(`Вы уверены, что хотите исключить пользователя ${userId}?`)) return;
        try {
            await this.client.kick(this.currentRoomId, userId);
            this.renderMembersList();
        } catch (e) {
            alert('Ошибка: ' + e.message);
        }
    }

    async handleBanMember(userId) {
        if (!confirm(`Вы уверены, что хотите забанить пользователя ${userId}?`)) return;
        try {
            await this.client.ban(this.currentRoomId, userId);
            this.renderMembersList();
        } catch (e) {
            alert('Ошибка: ' + e.message);
        }
    }

    async handlePromoteMember(userId) {
        if (!confirm(`Вы уверены, что хотите выдать права АДМИНИСТРАТОРА пользователю ${userId}?`)) return;
        try {
            await this.client.setPowerLevel(this.currentRoomId, userId, 100);
            this.renderMembersList();
            alert('Пользователь теперь администратор!');
        } catch (e) {
            alert('Ошибка: ' + e.message);
        }
    }

    // ==========================================
    // Public Room Search
    // ==========================================



    async joinPublicRoom(roomIdOrAlias) {
        try {
            const result = await this.client.joinRoom(roomIdOrAlias);

            console.log('Joined room:', result.roomId);

            this.closeModal('join-room-modal');

            // Wait for sync
            setTimeout(() => {
                this.loadRooms();
                this.selectRoom(result.roomId);
                this.switchTab('rooms');
            }, 1000);

        } catch (error) {
            console.error('Error joining room:', error);
            alert('Ошибка присоединения к комнате: ' + error.message);
        }
    }

    handleLogout() {
        if (this.client) {
            this.client.stopClient();
        }

        localStorage.removeItem('matrix_access_token');
        localStorage.removeItem('matrix_user_id');
        localStorage.removeItem('matrix_homeserver');

        this.client = null;
        this.currentRoomId = null;
        this.rooms.clear();

        this.showLoginScreen();

        // Reset form
        document.getElementById('login-form').reset();
        document.getElementById('homeserver').value = 'https://matrix.org';
    }

    // UI helpers
    showLoginScreen() {
        document.getElementById('login-screen').classList.add('active');
        document.getElementById('chat-screen').classList.remove('active');
    }

    showChatScreen() {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('chat-screen').classList.add('active');
    }

    getSenderName(userId) {
        const user = this.client.getUser(userId);
        return user?.displayName || userId.split(':')[0].substring(1);
    }

    getInitials(name) {
        if (!name) return '?';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();

        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }
    }

    async loadAuthenticatedImage(mxcUrl, container) {
        const loader = container.querySelector(`[data-mxc="${mxcUrl}"]`);
        if (!loader) return;
        const body = loader.dataset.body;

        const tryFetch = async (url) => {
            try {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.client.getAccessToken()}`
                    }
                });
                return response.ok ? response : null;
            } catch (e) {
                return null;
            }
        };

        try {
            const baseUrl = this.client.mxcUrlToHttp(mxcUrl).split('?')[0];
            const mxcParts = mxcUrl.split('/');
            const serverName = mxcParts[2];
            const mediaId = mxcParts[3];
            const homeServer = this.client.baseUrl.endsWith('/') ? this.client.baseUrl.slice(0, -1) : this.client.baseUrl;

            const urlsToTry = [
                // 1. Standard Client Media API (Newest)
                `${homeServer}/_matrix/client/v1/media/download/${serverName}/${mediaId}`,
                // 2. Legacy Media API v3
                baseUrl,
                // 3. Legacy Media API r0
                baseUrl.replace('/v3/', '/r0/'),
                // 4. Client Media API v3 (Some servers)
                `${homeServer}/_matrix/client/v3/media/download/${serverName}/${mediaId}`,
                // 5. Thumbnail fallback
                baseUrl.replace('/download/', '/thumbnail/') + '?width=1000&height=1000&method=scale'
            ];

            console.log(`[MEDIA DEBUG] Trying ${urlsToTry.length} endpoints for ${mxcUrl}`, urlsToTry);

            let response = null;
            let successUrl = '';
            for (const url of urlsToTry) {
                console.log(`[MEDIA DEBUG] Checking: ${url}`);
                response = await tryFetch(url);
                if (response) {
                    successUrl = url;
                    break;
                }
            }

            if (!response) {
                // LAST RESORT: Direct img tag with token
                console.log('[MEDIA DEBUG] All fetches failed. Trying direct img tag fallback.');
                const authUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(this.client.getAccessToken());
                loader.innerHTML = `
                    <a href="${authUrl}" target="_blank">
                        <img src="${authUrl}" alt="${body}" 
                             onerror="this.parentElement.parentElement.innerHTML='⚠️ 404: Файл не найден сервером'"
                             style="max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid var(--color-border); display: block;">
                    </a>`;
                return;
            }

            console.log(`[MEDIA DEBUG] SUCCESS! Loaded from: ${successUrl}`);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);

            loader.innerHTML = `
                <a href="${objectUrl}" target="_blank">
                    <img src="${objectUrl}" alt="${body}" 
                         style="max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid var(--color-border); display: block;">
                </a>`;
        } catch (error) {
            console.error('Failed to load image:', error);
            loader.innerHTML = `
                <div class="error-placeholder" style="color: var(--color-danger); padding: 10px; border: 1px dashed var(--color-danger); border-radius: 8px; font-size: 0.7rem;">
                    ⚠️ Ошибка (${error.message})<br>
                    <span style="opacity: 0.5; font-size: 0.6rem;">${mxcUrl}</span>
                </div>`;
        }
    }

    async loadAuthenticatedFile(mxcUrl, container) {
        const loader = container.querySelector(`[data-mxc="${mxcUrl}"]`);
        if (!loader) return;
        const body = loader.dataset.body;

        const tryFetch = async (url) => {
            try {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.client.getAccessToken()}`
                    }
                });
                return response.ok ? response : null;
            } catch (e) {
                return null;
            }
        };

        try {
            const baseUrl = this.client.mxcUrlToHttp(mxcUrl).split('?')[0];
            const mxcParts = mxcUrl.split('/');
            const serverName = mxcParts[2];
            const mediaId = mxcParts[3];
            const homeServer = this.client.baseUrl.endsWith('/') ? this.client.baseUrl.slice(0, -1) : this.client.baseUrl;

            const urlsToTry = [
                `${homeServer}/_matrix/client/v1/media/download/${serverName}/${mediaId}`,
                baseUrl,
                baseUrl.replace('/v3/', '/r0/'),
                `${homeServer}/_matrix/client/v3/media/download/${serverName}/${mediaId}`
            ];

            let response = null;
            let finalUrl = '';
            for (const url of urlsToTry) {
                response = await tryFetch(url);
                if (response) {
                    finalUrl = url;
                    break;
                }
            }

            if (!response) {
                loader.innerHTML = `
                    <div style="color: var(--color-danger); font-size: 0.8rem;">⚠️ Файл не найден (404)</div>
                `;
                return;
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);

            loader.innerHTML = `
                <a href="${objectUrl}" download="${body}" class="message-file-link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                        <polyline points="13 2 13 9 20 9"></polyline>
                    </svg>
                    ${this.escapeHtml(body)}
                </a>`;
        } catch (error) {
            console.error('Failed to load file:', error);
            loader.innerHTML = `<div style="color: var(--color-danger); font-size: 0.8rem;">⚠️ Ошибка: ${error.message}</div>`;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !this.currentRoomId) return;

        try {
            console.log('Uploading file:', file.name);

            // Upload to Matrix Media Repository
            const response = await this.client.uploadContent(file);
            console.log('File uploaded:', response);

            // Determine msgtype
            let msgtype = 'm.file';
            const fileType = file.type || '';
            const fileName = file.name.toLowerCase();

            if (fileType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/.test(fileName)) {
                msgtype = 'm.image';
            } else if (fileType.startsWith('video/') || /\.(mp4|webm|mov)$/.test(fileName)) {
                msgtype = 'm.video';
            } else if (fileType.startsWith('audio/') || /\.(mp3|wav|ogg)$/.test(fileName)) {
                msgtype = 'm.audio';
            }

            const content = {
                body: file.name,
                msgtype: msgtype,
                url: response.content_uri,
                info: {
                    mimetype: file.type,
                    size: file.size
                }
            };

            await this.client.sendEvent(this.currentRoomId, 'm.room.message', content);

            // Clear input
            event.target.value = '';

        } catch (error) {
            console.error('Error uploading file:', error);
            alert('Ошибка загрузки файла: ' + error.message);
        }
    }

    async leaveCurrentRoom() {
        if (!this.currentRoomId) return;

        if (!confirm('Вы уверены, что хотите выйти из этой комнаты?')) return;

        const roomId = this.currentRoomId;

        try {
            // Optimistically update UI
            const roomElement = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
            if (roomElement) {
                roomElement.remove();

                // Check if list is empty and show placeholder if needed
                if (document.getElementById('rooms-list').children.length === 0) {
                    const message = this.currentTab === 'dms'
                        ? 'У вас пока нет личных сообщений'
                        : 'У вас пока нет комнат';
                    document.getElementById('rooms-list').innerHTML = `
                        <div class="loading-rooms">
                            <p>${message}</p>
                        </div>
                    `;
                }
            }

            // Clear chat area
            document.getElementById('current-room-name').textContent = 'Выберите комнату';
            document.getElementById('room-members-count').textContent = '';
            document.getElementById('messages-container').innerHTML = `
                <div class="welcome-message">
                    <h3>Выберите комнату</h3>
                    <p>чтобы начать общение</p>
                </div>`;
            document.getElementById('room-settings-btn').style.display = 'none';
            document.getElementById('room-settings-menu').classList.add('hidden');
            document.getElementById('message-input').disabled = true;
            document.getElementById('send-btn').disabled = true;
            document.getElementById('attach-btn').disabled = true;

            this.currentRoomId = null;

            // Perform API call
            await this.client.leave(roomId);

            // Reload rooms from SDK to be sure (optional, but good for sync)
            setTimeout(() => this.loadRooms(), 1000);

        } catch (error) {
            console.error('Error leaving room:', error);
            alert('Ошибка выхода из комнаты: ' + error.message);
            // Revert on error would be complex, simplified to just alerting
            this.loadRooms();
        }
    }
    async loadAuthenticatedAvatar(mxcUrl, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!mxcUrl || typeof mxcUrl !== 'string' || !mxcUrl.startsWith('mxc://')) {
            console.log('[MEDIA DEBUG] Skipping invalid/non-mxc avatar:', mxcUrl);
            return;
        }

        const tryFetch = async (url) => {
            try {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.client.getAccessToken()}`
                    }
                });
                return response.ok ? response : null;
            } catch (e) {
                return null;
            }
        };

        try {
            const baseUrl = this.client.mxcUrlToHttp(mxcUrl).split('?')[0];
            const mxcParts = mxcUrl.split('/');
            const serverName = mxcParts[2];
            const mediaId = mxcParts[3];
            const homeServer = this.client.baseUrl.endsWith('/') ? this.client.baseUrl.slice(0, -1) : this.client.baseUrl;

            const urlsToTry = [
                `${homeServer}/_matrix/client/v1/media/download/${serverName}/${mediaId}`,
                baseUrl,
                baseUrl.replace('/download/', '/thumbnail/') + '?width=40&height=40&method=scale'
            ];

            let response = null;
            for (const url of urlsToTry) {
                response = await tryFetch(url);
                if (response) break;
            }

            if (!response) {
                // Fallback to initials (already there by default)
                return;
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            container.innerHTML = `<img src="${objectUrl}" alt="Avatar">`;
        } catch (error) {
            console.error('Failed to load avatar:', error);
        }
    }

    async openProfileModal() {
        const userId = this.client.getUserId();
        try {
            const profile = await this.client.getProfileInfo(userId);
            document.getElementById('profile-display-name').value = profile.displayname || '';

            const preview = document.getElementById('profile-avatar-preview');
            if (profile.avatar_url) {
                const mxcUrl = profile.avatar_url;
                const url = this.client.mxcUrlToHttp(mxcUrl, 100, 100, 'scale');
                // Use initials as placeholder while loading
                preview.innerHTML = this.getInitials(profile.displayname || userId);
                this.loadAuthenticatedAvatar(mxcUrl, 'profile-avatar-preview');
            } else {
                preview.innerHTML = this.getInitials(profile.displayname || userId);
            }

            this.openModal('profile-modal');
        } catch (error) {
            console.error('Error fetching profile:', error);
            alert('Не удалось загрузить данные профиля');
        }
    }

    openAppSettingsModal() {
        // Set toggle state based on localStorage
        const isRainEnabled = localStorage.getItem('matrix_rain_enabled') !== 'false'; // Default to true
        const rainToggle = document.getElementById('matrix-rain-toggle');
        if (rainToggle) {
            rainToggle.checked = isRainEnabled;
        }

        // Set lock toggle state
        const lockToggle = document.getElementById('app-lock-toggle');
        if (lockToggle) {
            lockToggle.checked = !!this.passcode;
        }

        this.openModal('app-settings-modal');
    }



    toggleMatrixRain(enabled) {
        localStorage.setItem('matrix_rain_enabled', enabled);
        const canvas = document.getElementById('matrix-rain');
        if (canvas) {
            canvas.style.display = enabled ? 'block' : 'none';
            // Trigger a resize to restart/stop animation logic if it relies on visibility
            window.dispatchEvent(new Event('resize'));
        }
    }

    // --- Passcode Logic ---

    startPasscodeSetup() {
        this.isPasscodeSetupMode = true;
        this.tempPasscode = null;
        this.currentPasscodeInput = '';
        this.updatePasscodeUI();
        this.showPasscodeScreen('setup');
        document.getElementById('passcode-title').textContent = 'Придумайте код доступа';
        document.getElementById('passcode-cancel-btn').classList.remove('hidden');

        // Ensure overlay is visible (remove hidden class if present)
        document.getElementById('passcode-overlay').classList.remove('hidden');
    }

    disablePasscode() {
        this.passcode = null;
        localStorage.removeItem('app_passcode');
        alert('Вход по PIN-коду отключен');
    }

    showPasscodeScreen(mode) {
        const overlay = document.getElementById('passcode-overlay');
        overlay.classList.remove('hidden');
        document.getElementById('passcode-cancel-btn').classList.toggle('hidden', mode === 'unlock');

        if (mode === 'unlock') {
            document.getElementById('passcode-title').textContent = 'Введите код доступа';
        }
    }

    hidePasscodeScreen() {
        const overlay = document.getElementById('passcode-overlay');
        overlay.classList.add('hidden');
        this.currentPasscodeInput = '';
        this.updatePasscodeUI();
    }

    cancelPasscodeAction() {
        this.hidePasscodeScreen();
        this.isPasscodeSetupMode = false;
        this.tempPasscode = null;
        this.currentPasscodeInput = '';

        // Revert toggle if in settings
        const lockToggle = document.getElementById('app-lock-toggle');
        if (lockToggle) {
            lockToggle.checked = !!this.passcode;
        }
    }

    handlePasscodeInput(key) {
        if (this.currentPasscodeInput.length >= 4) return;

        this.currentPasscodeInput += key;
        this.updatePasscodeUI();

        if (this.currentPasscodeInput.length === 4) {
            setTimeout(() => this.checkPasscode(), 300);
        }
    }

    handlePasscodeDelete() {
        if (this.currentPasscodeInput.length > 0) {
            this.currentPasscodeInput = this.currentPasscodeInput.slice(0, -1);
            this.updatePasscodeUI();
        }
    }

    updatePasscodeUI() {
        const dots = document.querySelectorAll('.passcode-dots .dot');
        dots.forEach((dot, index) => {
            dot.classList.toggle('filled', index < this.currentPasscodeInput.length);
            dot.classList.remove('error');
        });
    }

    checkPasscode() {
        const input = this.currentPasscodeInput;

        if (this.isPasscodeSetupMode) {
            if (!this.tempPasscode) {
                // First step done, ask for confirmation
                this.tempPasscode = input;
                this.currentPasscodeInput = '';
                this.updatePasscodeUI();
                document.getElementById('passcode-title').textContent = 'Повторите код доступа';
            } else {
                // Confirmation step
                if (input === this.tempPasscode) {
                    // Success
                    this.passcode = input;
                    localStorage.setItem('app_passcode', input);
                    this.isPasscodeSetupMode = false;
                    this.hidePasscodeScreen();

                    // Update toggle
                    const lockToggle = document.getElementById('app-lock-toggle');
                    if (lockToggle) lockToggle.checked = true;

                    alert('PIN-код установлен');
                } else {
                    // Mismatch
                    this.visualError();
                    document.getElementById('passcode-title').textContent = 'Коды не совпадают. Повторите.';
                    this.currentPasscodeInput = '';
                    this.updatePasscodeUI();
                    this.tempPasscode = null;
                    document.getElementById('passcode-title').textContent = 'Придумайте код доступа';
                }
            }
        } else {
            // Unlock Mode
            if (input === this.passcode) {
                this.hidePasscodeScreen();
            } else {
                this.visualError();
                this.currentPasscodeInput = '';
                this.updatePasscodeUI();
            }
        }
    }

    visualError() {
        const dots = document.querySelectorAll('.passcode-dots .dot');
        dots.forEach(dot => dot.classList.add('error'));
        setTimeout(() => {
            dots.forEach(dot => dot.classList.remove('error'));
        }, 400);
    }

    async handleAvatarPreview(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const preview = document.getElementById('profile-avatar-preview');
            preview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
    }

    async handleProfileUpdate() {
        const displayName = document.getElementById('profile-display-name').value;
        const avatarFile = document.getElementById('avatar-upload').files[0];
        const saveBtn = document.getElementById('save-profile-btn');

        saveBtn.disabled = true;
        saveBtn.textContent = 'Сохранение...';

        try {
            // Update display name
            await this.client.setDisplayName(displayName);

            // Update avatar if file selected
            if (avatarFile) {
                const uploadResult = await this.client.uploadContent(avatarFile);
                await this.client.setAvatarUrl(uploadResult.content_uri);
            }

            this.closeModal('profile-modal');
            this.updateUserDisplay();
            alert('Профиль успешно обновлен!');
        } catch (error) {
            console.error('Error updating profile:', error);
            alert('Ошибка при обновлении профиля: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Сохранить';
        }
    }

    async updateUserDisplay() {
        const userId = this.client.getUserId();
        try {
            const profile = await this.client.getProfileInfo(userId);
            document.getElementById('user-display-name').textContent = profile.displayname || userId;
            document.getElementById('user-id').textContent = userId;

            if (profile.avatar_url) {
                this.loadAuthenticatedAvatar(profile.avatar_url, 'user-avatar');
            } else {
                document.getElementById('user-avatar').innerHTML = `${this.getInitials(profile.displayname || userId)}<div class="status-indicator online"></div>`;
            }
        } catch (error) {
            console.error('Error updating user display:', error);
        }
    }

    setTheme(theme) {
        // Save to localStorage
        localStorage.setItem('matrix_theme', theme);

        console.log(`%c [THEME] Applying theme: ${theme}`, 'background: #222; color: #00ff00; font-weight: bold;');

        // Apply to both body and html for maximum compatibility
        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);

        // Final check for accent color to verify variables
        const computedAccent = getComputedStyle(document.body).getPropertyValue('--color-accent-green');
        console.log(`[THEME] Computed accent color: ${computedAccent}`);

        // Update UI swatches
        document.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.classList.toggle('active', swatch.dataset.theme === theme);
        });

        console.log(`[THEME] Switched to: ${theme}`);
    }

    async requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                await Notification.requestPermission();
            }
        }
    }

    showNotification(event, room) {
        const sender = event.sender ? (event.sender.name || event.getSender()) : event.getSender();
        const body = event.getContent().body;
        const myUserId = this.client.getUserId();
        const roomId = event.getRoomId();

        // Don't show notifications for my own messages
        if (event.getSender() === myUserId) return;

        // Don't show if we are already looking at this room AND the window is focused
        if (roomId === this.currentRoomId && document.hasFocus()) return;

        const roomName = room.name || roomId;

        // 1. Browser Notification
        if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification(`Type-C: ${sender}`, {
                body: body,
                icon: 'favicon.ico', // You might need a real icon path
                tag: roomId // Group notifications by room
            });
            n.onclick = () => {
                window.focus();
                this.selectRoom(roomId);
                n.close();
            };
        }

        // 2. In-app Toast
        const container = document.getElementById('notification-container');
        if (container) {
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = `
                <div class="toast-header">
                    <span class="toast-sender">${sender}</span>
                    <span class="toast-room">${roomName}</span>
                </div>
                <div class="toast-body">${body}</div>
            `;

            toast.onclick = () => {
                this.selectRoom(roomId);
                toast.classList.add('hide');
                setTimeout(() => toast.remove(), 300);
            };

            container.appendChild(toast);

            // Auto-hide after 5 seconds
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.classList.add('hide');
                    setTimeout(() => toast.remove(), 300);
                }
            }, 5000);
        }
    }

    async openSummaryModal() {
        const summaryModal = document.getElementById('summary-modal');
        if (!summaryModal) return;

        // 1. Unread Messages
        const unreadList = document.getElementById('summary-unread-list');
        if (unreadList) {
            unreadList.innerHTML = '';
            const rooms = this.client.getRooms();
            const roomsWithUnread = rooms
                .filter(r => r.getMyMembership() === 'join')
                .filter(r => r.getUnreadNotificationCount('total') > 0)
                .sort((a, b) => b.getUnreadNotificationCount('total') - a.getUnreadNotificationCount('total'));

            if (roomsWithUnread.length > 0) {
                roomsWithUnread.forEach(room => {
                    const unreadCount = room.getUnreadNotificationCount('total');
                    const lastEvent = room.timeline[room.timeline.length - 1];
                    const lastMsg = lastEvent ? (lastEvent.getContent().body || 'Новое сообщение') : '...';

                    const item = document.createElement('div');
                    item.className = 'summary-item';
                    const displayMsg = String(lastMsg || '...').substring(0, 30);
                    item.innerHTML = `
                        <div class="summary-item-info">
                            <span class="summary-item-name">${this.escapeHtml(room.name || 'Безымянная')}</span>
                            <span class="summary-item-meta">${this.escapeHtml(displayMsg)}${displayMsg.length >= 30 ? '...' : ''}</span>
                        </div>
                        <span class="unread-badge">${unreadCount}</span>
                    `;
                    item.onclick = () => {
                        this.closeModal('summary-modal');
                        this.selectRoom(room.roomId);
                    };
                    unreadList.appendChild(item);
                });
            } else {
                unreadList.innerHTML = '<p class="empty-text">Все сообщения прочитаны</p>';
            }
        }

        // 2. Recent Activity
        const recentList = document.getElementById('summary-recent-list');
        if (recentList) {
            recentList.innerHTML = '';
            if (this.recentRooms.length > 0) {
                this.recentRooms.forEach(roomId => {
                    const room = this.client.getRoom(roomId);
                    if (room) {
                        const item = document.createElement('div');
                        item.className = 'summary-item';
                        item.innerHTML = `
                            <div class="summary-item-info">
                                <span class="summary-item-name">${this.escapeHtml(room.name)}</span>
                                <span class="summary-item-meta">Недавняя активность</span>
                            </div>
                        `;
                        item.onclick = () => {
                            this.closeModal('summary-modal');
                            this.selectRoom(roomId);
                        };
                        recentList.appendChild(item);
                    }
                });
            } else {
                recentList.innerHTML = '<p class="empty-text">Пока нет недавней активности</p>';
            }
        }

        // 3. Calendar & Time
        // Reset calendar to current month
        const now = new Date();
        this.currentCalendarMonth = now.getMonth();
        this.currentCalendarYear = now.getFullYear();
        this.renderCalendar();
        this.renderQuote();
        this.startSummaryWidgets();

        this.openModal('summary-modal');
    }

    trackRecentRoom(roomId) {
        if (!roomId) return;
        this.recentRooms = [roomId, ...this.recentRooms.filter(id => id !== roomId)].slice(0, 5);
    }

    startSummaryWidgets() {
        if (this.summaryInterval) clearInterval(this.summaryInterval);

        const update = () => {
            const timeEl = document.getElementById('summary-time');
            const dateEl = document.getElementById('summary-date');
            const now = new Date();

            if (timeEl) {
                const hours = String(now.getHours()).padStart(2, '0');
                const mins = String(now.getMinutes()).padStart(2, '0');
                const secs = String(now.getSeconds()).padStart(2, '0');
                timeEl.innerHTML = `${hours}<span class="clock-colon">:</span>${mins}<span class="clock-seconds">:${secs}</span>`;
            }
            if (dateEl) {
                try {
                    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                    let dateStr = now.toLocaleDateString('ru-RU', options);
                    if (dateStr && dateStr.length > 2) {
                        dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
                        dateEl.textContent = dateStr;
                    }
                } catch (e) {
                    console.warn('[UI] Localized date failed, using fallback');
                    dateEl.textContent = now.toDateString();
                }
            }
        };

        update();
        this.summaryInterval = setInterval(update, 1000);
    }

    renderCalendar() {
        const calContainer = document.getElementById('calendar-widget');
        const monthYearEl = document.getElementById('calendar-month-year');
        if (!calContainer || !monthYearEl) return;

        const month = this.currentCalendarMonth;
        const year = this.currentCalendarYear;
        const now = new Date();
        const today = (month === now.getMonth() && year === now.getFullYear()) ? now.getDate() : -1;

        const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
        ];
        monthYearEl.textContent = `${monthNames[month]} ${year}`;

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Adjust for Monday start (0: Mon, ..., 6: Sun)
        let startingDay = firstDay === 0 ? 6 : firstDay - 1;

        let html = '<div class="calendar-grid">';
        const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        labels.forEach(l => html += `<div class="calendar-day-label">${l}</div>`);

        for (let i = 0; i < startingDay; i++) {
            html += '<div class="calendar-day empty"></div>';
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const isToday = i === today;
            const m = month + 1;
            const dateStr = `${year}${String(m).padStart(2, '0')}${String(i).padStart(2, '0')}`;
            const mmdd = `${String(m).padStart(2, '0')}${String(i).padStart(2, '0')}`;
            const label = `${i} ${monthNames[month]}`;

            // Collect unique holidays
            const exactHolidays = this.holidays[dateStr] || [];
            const recurringHolidays = this.holidays[mmdd] || [];
            const combinedEvents = [...exactHolidays, ...recurringHolidays];

            const uniqueEvents = [];
            const seen = new Set();
            combinedEvents.forEach(ev => {
                const key = `${ev.summary}|${ev.description}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueEvents.push(ev);
                }
            });

            const isHoliday = uniqueEvents.length > 0;
            const title = uniqueEvents.map(e => e.summary).join(', ');

            html += `<div class="calendar-day ${isToday ? 'current' : ''} ${isHoliday ? 'holiday' : ''}" 
                        title="${this.escapeHtml(title)}"
                        onclick="window.messenger.showHolidayDetailsForDate('${dateStr}', '${mmdd}', '${this.escapeHtml(label)}')">${i}</div>`;
        }
        html += '</div>';
        html += '<div id="holiday-info" class="holiday-info-box">Нажмите на праздник для описания</div>';
        calContainer.innerHTML = html;
    }

    changeMonth(delta) {
        this.currentCalendarMonth += delta;
        if (this.currentCalendarMonth > 11) {
            this.currentCalendarMonth = 0;
            this.currentCalendarYear++;
        } else if (this.currentCalendarMonth < 0) {
            this.currentCalendarMonth = 11;
            this.currentCalendarYear--;
        }
        this.renderCalendar();
    }

    showHolidayDetailsForDate(fullDate, mmdd, label) {
        const infoBox = document.getElementById('holiday-info');
        if (!infoBox) return;

        const exactHolidays = this.holidays[fullDate] || [];
        const recurringHolidays = this.holidays[mmdd] || [];
        const combinedEvents = [...exactHolidays, ...recurringHolidays];

        const uniqueEvents = [];
        const seen = new Set();
        combinedEvents.forEach(ev => {
            const key = `${ev.summary}|${ev.description}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueEvents.push(ev);
            }
        });

        if (uniqueEvents.length === 0) {
            infoBox.innerHTML = 'Нажмите на праздник для описания';
            infoBox.classList.remove('active');
            return;
        }

        let html = `
            <div class="holiday-info-header">
                <span class="holiday-info-date">${this.escapeHtml(label)}</span>
                <button class="btn-close-small" onclick="this.parentElement.parentElement.classList.remove('active')">&times;</button>
            </div>
        `;
        uniqueEvents.forEach(ev => {
            const desc = (ev.description || 'Описание отсутствует').trim();
            html += `<div class="holiday-detail-item">
                        <strong>${this.escapeHtml(ev.summary)}</strong>
                        <p>${this.escapeHtml(desc).replace(/\n/g, '<br>')}</p>
                     </div>`;
        });
        infoBox.innerHTML = html;
        infoBox.classList.add('active');
        infoBox.scrollTop = 0;
    }

    async loadQuotes() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/umniystakan/Type-C/refs/heads/main/quotes.json');
            if (response.ok) {
                this.quotes = await response.json();
                console.log('[UI] Quotes loaded:', this.quotes.length);

                // If summary modal is already open, render a quote now
                const modal = document.getElementById('summary-modal');
                if (modal && modal.classList.contains('active')) {
                    this.renderQuote();
                }
            }
        } catch (error) {
            console.error('[UI] Failed to load quotes:', error);
        }
    }

    renderQuote() {
        const quoteTextEl = document.getElementById('summary-quote-text');
        const quoteAuthorEl = document.getElementById('summary-quote-author');
        if (!quoteTextEl || !quoteAuthorEl || this.quotes.length === 0) return;

        // Random selection with sequential repeat prevention
        let index;
        const lastIndex = parseInt(localStorage.getItem('typec_last_quote_index') || '-1');

        if (this.quotes.length > 1) {
            do {
                index = Math.floor(Math.random() * this.quotes.length);
            } while (index === lastIndex);
        } else {
            index = 0;
        }

        localStorage.setItem('typec_last_quote_index', index);
        const quote = this.quotes[index];

        quoteTextEl.textContent = `"${quote.text}"`;
        quoteAuthorEl.textContent = `— ${quote.author}`;
    }

    async loadHolidays() {
        const url = 'https://raw.githubusercontent.com/umniystakan/Type-C/refs/heads/main/ical-wholeworld.ics';
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.text();
            this.holidays = this.parseICS(data);
            console.log(`[UI] Loaded ${Object.keys(this.holidays).length} holiday dates`);

            // Re-render if summary is open
            const summaryModal = document.getElementById('summary-modal');
            if (summaryModal && summaryModal.classList.contains('active')) {
                this.renderCalendar();
            }
        } catch (error) {
            console.error('[UI] Failed to load holidays:', error);
        }
    }

    parseICS(data) {
        const holidays = {};
        // 1. Unfold content (lines starting with space/tab are continuations)
        const unfolded = data.replace(/\r?\n[ \t]/g, '');
        const lines = unfolded.split(/\r?\n/);

        let currentEvent = null;

        const cleanValue = (val) => {
            if (!val) return "";
            return val
                .replace(/\\n/gi, "\n")
                .replace(/\\,/g, ",")
                .replace(/\\;/g, ";")
                .replace(/\\\\/g, "\\")
                .trim();
        };

        lines.forEach(line => {
            if (line.startsWith('BEGIN:VEVENT')) {
                currentEvent = { summary: '', date: '', description: '', isYearly: false };
            } else if (line.startsWith('END:VEVENT')) {
                if (currentEvent && currentEvent.date && currentEvent.summary) {
                    const eventData = {
                        summary: currentEvent.summary,
                        description: currentEvent.description || ''
                    };

                    const dateKey = currentEvent.date;
                    if (!holidays[dateKey]) holidays[dateKey] = [];
                    holidays[dateKey].push(eventData);

                    if (currentEvent.isYearly) {
                        const mmdd = dateKey.slice(4);
                        if (!holidays[mmdd]) holidays[mmdd] = [];
                        holidays[mmdd].push(eventData);
                    }
                }
                currentEvent = null;
            } else if (currentEvent) {
                const colonIndex = line.indexOf(':');
                if (colonIndex === -1) return;

                const propPart = line.substring(0, colonIndex);
                const valuePart = line.substring(colonIndex + 1);

                if (propPart.startsWith('DTSTART')) {
                    const match = valuePart.match(/(\d{8})/);
                    if (match) currentEvent.date = match[1];
                } else if (propPart.startsWith('RRULE')) {
                    if (valuePart.includes('FREQ=YEARLY')) currentEvent.isYearly = true;
                } else if (propPart.startsWith('SUMMARY')) {
                    currentEvent.summary = cleanValue(valuePart);
                } else if (propPart.startsWith('DESCRIPTION')) {
                    currentEvent.description = cleanValue(valuePart);
                }
            }
        });
        return holidays;
    }

    async markAsRead(roomId) {
        if (!this.client || !roomId) return;
        try {
            const room = this.client.getRoom(roomId);
            if (!room) return;

            // Use LiveTimeline for the most up-to-date end event
            const liveTimeline = room.getLiveTimeline();
            const events = liveTimeline.getEvents();

            if (events && events.length > 0) {
                const lastEvent = events[events.length - 1];
                const eventId = lastEvent.getId();

                console.log(`[UI] Persistent Read: Room ${roomId} up to ${eventId}`);

                // 1. Reset counts locally first for immediate UI snap
                if (typeof room.setUnreadNotificationCount === 'function') {
                    room.setUnreadNotificationCount('total', 0);
                    room.setUnreadNotificationCount('highlight', 0);
                }

                // 2. Send official receipt (m.read) - resets server-side count
                await this.client.sendReadReceipt(lastEvent).catch(e => console.warn('sendReadReceipt failed:', e));

                // 3. Set private markers (fully_read) - used for the "red line" in some apps
                await this.client.setRoomReadMarkers(roomId, eventId, eventId).catch(e => console.warn('setRoomReadMarkers failed:', e));

                // Update room list UI
                this.loadRooms();

                // Refresh Summary if open
                const summaryModal = document.getElementById('summary-modal');
                if (summaryModal && summaryModal.classList.contains('show')) {
                    this.openSummaryModal();
                }
            }
        } catch (error) {
            console.warn('[UI] Failed to mark room as read:', error);
        }
    }

    escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // ==========================================
    // Matrix Rain Toggle
    // ==========================================
    toggleMatrixRain(enabled) {
        const canvas = document.getElementById('matrix-rain');
        if (canvas) {
            canvas.style.display = enabled ? 'block' : 'none';
        }
        localStorage.setItem('matrix_rain_enabled', enabled ? 'true' : 'false');
        console.log('[SETTINGS] Matrix Rain:', enabled ? 'ON' : 'OFF');
    }

    // ==========================================
    // Passcode Lock System
    // ==========================================
    passcodeBuffer = '';
    passcodeMode = 'unlock'; // 'unlock', 'setup', 'confirm', 'disable'
    tempPasscode = '';

    startPasscodeSetup() {
        this.passcodeMode = 'setup';
        this.passcodeBuffer = '';
        this.tempPasscode = '';

        const overlay = document.getElementById('passcode-overlay');
        const title = document.getElementById('passcode-title');
        const cancelBtn = document.getElementById('passcode-cancel-btn');

        if (overlay) overlay.classList.remove('hidden');
        if (title) title.textContent = 'Создайте PIN-код';
        if (cancelBtn) cancelBtn.classList.remove('hidden');

        this.updatePasscodeDots();
    }

    disablePasscode() {
        this.passcodeMode = 'disable';
        this.passcodeBuffer = '';

        const overlay = document.getElementById('passcode-overlay');
        const title = document.getElementById('passcode-title');
        const cancelBtn = document.getElementById('passcode-cancel-btn');

        if (overlay) overlay.classList.remove('hidden');
        if (title) title.textContent = 'Введите текущий PIN для отключения';
        if (cancelBtn) cancelBtn.classList.remove('hidden');

        this.updatePasscodeDots();
    }

    handlePasscodeInput(digit) {
        if (this.passcodeBuffer.length >= 4) return;

        this.passcodeBuffer += digit;
        this.updatePasscodeDots();

        if (this.passcodeBuffer.length === 4) {
            setTimeout(() => this.checkPasscode(), 200);
        }
    }

    handlePasscodeDelete() {
        if (this.passcodeBuffer.length > 0) {
            this.passcodeBuffer = this.passcodeBuffer.slice(0, -1);
            this.updatePasscodeDots();
        }
    }

    updatePasscodeDots() {
        const dots = document.querySelectorAll('#passcode-dots .dot');
        dots.forEach((dot, i) => {
            dot.classList.toggle('filled', i < this.passcodeBuffer.length);
        });
    }

    checkPasscode() {
        const storedHash = localStorage.getItem('app_passcode_hash');
        const inputHash = this.hashPasscode(this.passcodeBuffer);

        if (this.passcodeMode === 'unlock') {
            if (inputHash === storedHash) {
                this.unlockApp();
            } else {
                this.shakePasscode();
            }
        } else if (this.passcodeMode === 'setup') {
            this.tempPasscode = this.passcodeBuffer;
            this.passcodeBuffer = '';
            this.passcodeMode = 'confirm';
            document.getElementById('passcode-title').textContent = 'Подтвердите PIN-код';
            this.updatePasscodeDots();
        } else if (this.passcodeMode === 'confirm') {
            if (this.passcodeBuffer === this.tempPasscode) {
                localStorage.setItem('app_passcode_hash', this.hashPasscode(this.passcodeBuffer));
                document.getElementById('app-lock-toggle').checked = true;
                this.hidePasscodeOverlay();
                console.log('[SECURITY] PIN code set successfully');
            } else {
                this.shakePasscode();
                this.passcodeBuffer = '';
                this.passcodeMode = 'setup';
                document.getElementById('passcode-title').textContent = 'PIN не совпал. Попробуйте снова';
                this.updatePasscodeDots();
            }
        } else if (this.passcodeMode === 'disable') {
            if (inputHash === storedHash) {
                localStorage.removeItem('app_passcode_hash');
                document.getElementById('app-lock-toggle').checked = false;
                this.hidePasscodeOverlay();
                console.log('[SECURITY] PIN code disabled');
            } else {
                this.shakePasscode();
            }
        }
    }

    hashPasscode(pin) {
        // Simple hash for localStorage (not cryptographically secure, but OK for local PIN)
        let hash = 0;
        for (let i = 0; i < pin.length; i++) {
            const char = pin.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'PIN_' + Math.abs(hash).toString(16);
    }

    unlockApp() {
        this.hidePasscodeOverlay();
        console.log('[SECURITY] App unlocked');
    }

    hidePasscodeOverlay() {
        const overlay = document.getElementById('passcode-overlay');
        if (overlay) overlay.classList.add('hidden');
        this.passcodeBuffer = '';
        this.passcodeMode = 'unlock';
    }

    shakePasscode() {
        const container = document.querySelector('.passcode-container');
        if (container) {
            container.classList.add('shake');
            setTimeout(() => container.classList.remove('shake'), 500);
        }
        this.passcodeBuffer = '';
        this.updatePasscodeDots();
    }

    cancelPasscodeSetup() {
        this.hidePasscodeOverlay();
        // Reset toggle to previous state
        const toggle = document.getElementById('app-lock-toggle');
        if (toggle) {
            toggle.checked = !!localStorage.getItem('app_passcode_hash');
        }
    }

    checkAppLock() {
        const storedHash = localStorage.getItem('app_passcode_hash');
        if (storedHash) {
            this.passcodeMode = 'unlock';
            this.passcodeBuffer = '';
            const overlay = document.getElementById('passcode-overlay');
            const title = document.getElementById('passcode-title');
            const cancelBtn = document.getElementById('passcode-cancel-btn');

            if (overlay) overlay.classList.remove('hidden');
            if (title) title.textContent = 'Введите код доступа';
            if (cancelBtn) cancelBtn.classList.add('hidden');

            this.updatePasscodeDots();

            // Sync toggle state
            const toggle = document.getElementById('app-lock-toggle');
            if (toggle) toggle.checked = true;
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new TypeCMessenger();
    });
} else {
    new TypeCMessenger();
}
