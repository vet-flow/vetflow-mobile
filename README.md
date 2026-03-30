# VetFlow Mobile

PWA (Progressive Web App) dla klinik weterynaryjnych.

## Funkcje (roadmapa)
- Push notifications (nowa rezerwacja, wyniki Skyla, zamówiony lek)
- Kalendarz dzienny (widok wizyt na dziś)
- Caller ID (popup z danymi klienta przy połączeniu)

## Stack
- Vanilla JS + Service Worker (Web Push API)
- FastAPI backend (push subscriptions endpoint w głównym VetFlow)
- Caddy: subdomena mobile.vet-flow.pl → statyczne pliki

## Deploy
Statyczne pliki — Caddy serwuje z /home/seba/vetflow-mobile/public/
