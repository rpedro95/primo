// Service Worker para Podcast Battle
const CACHE_NAME = 'podcast-battle-v2';
const urlsToCache = [
  '/',
  '/add.html',
  '/test-sw.html',
  '/manifest.json',
  '/sw.js',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11'
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching files');
        // Cache apenas ficheiros essenciais
        return cache.addAll([
          '/'
        ]);
      })
      .then(() => {
        console.log('Service Worker: Installed successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Install failed:', error);
      })
  );
});

// Ativar Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activated successfully');
      return self.clients.claim();
    })
  );
});

// Interceptar requests
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Retornar do cache se disponível
        if (response) {
          return response;
        }
        // Senão, fazer fetch da rede
        return fetch(event.request);
      })
  );
});

// Escutar notificações push
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received');
  
  let notificationData = {
    title: 'Podcast Battle',
    body: 'Nova notificação!',
    icon: '/img/notification-icon.png',
    badge: '/img/badge-icon.png',
    tag: 'podcast-notification',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Abrir App',
        icon: '/img/open-icon.png'
      },
      {
        action: 'dismiss',
        title: 'Dispensar',
        icon: '/img/dismiss-icon.png'
      }
    ]
  };

  // Se há dados no push
  if (event.data) {
    try {
      const data = event.data.json();
      console.log('Service Worker: Push data received:', data);
      
      const episodeText = data.data?.episodeNumber ? ` - Ep ${data.data.episodeNumber}` : '';
      
      console.log('Service Worker: Creating notification with:');
      console.log('  fromUser:', data.data?.fromUser);
      console.log('  rating:', data.data?.rating);
      console.log('  message:', data.data?.message);
      console.log('  podcastName:', data.title);
      
      notificationData = {
        title: `🎧 ${data.title}${episodeText}`,
        body: `${data.data.fromUser} avaliou com ${data.data.rating}/10: "${data.data.message}"`,
        icon: '/img/icon-192.svg',
        badge: '/img/badge-72.svg',
        tag: `podcast-${data.title}-${Date.now()}`,
        requireInteraction: true,
        data: {
          url: '/',
          podcastName: data.title,
          fromUser: data.data.fromUser,
          rating: data.data.rating,
          message: data.data.message,
          episodeNumber: data.data?.episodeNumber
        },
        actions: [
          {
            action: 'open',
            title: 'Ver Rating',
            icon: '/img/open-icon.png'
          },
          {
            action: 'dismiss',
            title: 'Dispensar',
            icon: '/img/dismiss-icon.png'
          }
        ]
      };
    } catch (error) {
      console.error('Service Worker: Error parsing push data:', error);
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Escutar cliques nas notificações
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked');
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  // Abrir a app
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Se já há uma janela aberta, focar nela
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abrir nova janela
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Escutar mensagens da app
self.addEventListener('message', (event) => {
  console.log('Service Worker: Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('Service Worker: Script loaded');
