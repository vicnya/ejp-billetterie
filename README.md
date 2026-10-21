# Billetterie – Les 7000 Adorateurs Non Souillés

Mini-app d'inscription gratuite avec billet QR code (EJP Charleroi, 11/11/2026, 14h).

- `/` page publique d'inscription (la jauge n'est jamais affichée)
- `/billet/:token` billet personnel (image téléchargeable + partage WhatsApp)
- `/scan` contrôle d'accès caméra, protégé par code PIN (plusieurs téléphones en même temps)
- `/admin` tableau de bord : KPI, liste, recherche, ajout manuel, annulation, export CSV, ouverture/fermeture, jauge

## Variables d'environnement

| Variable | Exemple | Rôle |
|---|---|---|
| `DATABASE_URL` | fournie par Railway Postgres | base de données |
| `BASE_URL` | `https://ejp-billetterie.up.railway.app` | liens dans les e-mails |
| `CAPACITY` | `100` | jauge initiale (modifiable dans l'admin) |
| `ADMIN_PASSWORD` | — | mot de passe `/admin` (marche aussi sur `/scan`) |
| `SCAN_PIN` | — | code PIN des bénévoles sur `/scan` |
| `SESSION_SECRET` | longue chaîne aléatoire | signature des sessions |
| `CLOSE_AT` | `2026-11-11T13:00:00+01:00` | fermeture automatique des inscriptions |
| `MAIL_PROVIDER` | `brevo` ou `resend` | active l'envoi du billet par e-mail |
| `BREVO_API_KEY` / `RESEND_API_KEY` | — | clé API du fournisseur |
| `MAIL_FROM` | `contact@...` | expéditeur (vérifié chez le fournisseur) |
| `MAIL_FROM_NAME` | `EJP Charleroi` | nom affiché |
| `MAIL_REPLY_TO` | — | adresse de réponse (optionnel) |

## Lancer en local

```
npm install
DATABASE_URL=postgres://... ADMIN_PASSWORD=... SCAN_PIN=... npm start
```
