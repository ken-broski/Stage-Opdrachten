# Buurthuis Gultekin

Een activiteitenwebsite voor Buurthuis Gultekin met een openbare agenda, inschrijvingen en een beheeromgeving. De medewerkers kunnen activiteiten en categorieën beheren, deelnemers annuleren en deelnemerslijsten als CSV downloaden.

## Techniek

- **Frontend:** HTML, CSS en JavaScript zonder frontend-framework. Dat houdt de website licht en maakt de pagina's eenvoudig aanpasbaar.
- **Backend:** Node.js met de ingebouwde HTTP-server. De API controleert invoer en toegang op de server.
- **Database:** SQLite via `node:sqlite`. Voor een project voor één buurthuis is een relationele database zonder aparte databaseserver praktisch. De tabellen leggen relaties tussen medewerkers, categorieën, activiteiten en aanmeldingen vast.

Er zijn geen npm-pakketten nodig. Gebruik Node.js 22.5 of hoger.

## Starten op Windows

Open PowerShell in deze map en stel de eerste beheerder in. Gebruik een eigen sterk wachtwoord; de waarden worden niet in de broncode opgeslagen:

```powershell
$env:ADMIN_EMAIL = "beheer@jouwdomein.nl"
$env:ADMIN_PASSWORD = "gebruik-een-eigen-wachtwoord-van-minimaal-12-tekens"
npm.cmd start
```

Open daarna [http://localhost:3000](http://localhost:3000). De beheeromgeving staat op [http://localhost:3000/beheer](http://localhost:3000/beheer). Bewaar de omgevingsvariabelen en het bestand `data/activiteiten.sqlite` buiten versiebeheer. Stel de eerste beheerder alleen bij de eerste start in; daarna worden beheerdersgegevens uit de database gebruikt.

De database en drie voorbeeldactiviteiten worden automatisch aangemaakt bij de eerste start. De voorbeeldactiviteiten gebruiken datums die relatief aan het moment van starten in de toekomst liggen. Om een nieuwe lege database te beginnen, stop je de server en verwijder je alleen het bestand `data/activiteiten.sqlite`.

## Datamodel

- **Medewerker** (`employees`): beheerders-e-mailadres en een met scrypt gehashte wachtwoordwaarde. Een medewerker kan activiteiten aanmaken.
- **Categorie** (`categories`): naam; een categorie heeft meerdere activiteiten.
- **Activiteit** (`events`): verwijst met `category_id` naar een categorie en met `created_by_employee_id` naar de medewerker die de activiteit heeft aangemaakt; bevat ook titel, beschrijving, datum/tijd, locatie, afbeeldingslink, capaciteit en status (`draft`, `published` of `cancelled`).
- **Aanmelding** (`registrations`): verwijst met `event_id` naar een activiteit en bevat naam, e-mailadres en status (`active` of `cancelled`).

De relatie tussen medewerker en activiteit is optioneel in de database om bestaande activiteiten bij een databaseschema-update te behouden. Alle activiteiten die via de beheeromgeving worden aangemaakt, worden aan de ingelogde medewerker gekoppeld.

Een unieke gedeeltelijke database-index voorkomt meerdere actieve aanmeldingen met hetzelfde e-mailadres voor dezelfde activiteit. Nieuwe aanmeldingen worden in een `BEGIN IMMEDIATE`-transactie verwerkt; de beschikbaarheid wordt binnen die transactie gecontroleerd en bijgewerkt. Daardoor kan de capaciteit ook bij gelijktijdige aanvragen niet worden overschreden. Geannuleerde aanmeldingen tellen niet mee in de capaciteit.

## Beheer en privacy

Alle beheer-API-routes vereisen een geldige sessiecookie (`HttpOnly`, `SameSite=Strict`). De server geeft deelnemersgegevens en CSV-bestanden alleen terug na deze controle. Wachtwoorden worden met een unieke salt en scrypt gehasht. De sessies verlopen na acht uur en worden bij een serverherstart ongeldig. Zet `COOKIE_SECURE=true` als de website via HTTPS draait.

De openbare agenda toont alleen toekomstige, gepubliceerde activiteiten. De detailroute laat een geannuleerde activiteit herkenbaar zien, maar accepteert daarvoor geen aanmeldingen. Conceptactiviteiten en deelnemersgegevens zijn niet openbaar.

## Aanmeldingen resetten

In de beheeromgeving staat **Alle aanmeldingen wissen**. Na bevestiging worden alle aanmeldingen verwijderd; activiteiten en categorieën blijven behouden en de vrije plaatsen zijn weer beschikbaar. Deze actie verwijdert ook aanmeldingen met de status geannuleerd en kan niet ongedaan worden gemaakt. De actie is alleen beschikbaar voor ingelogde medewerkers.

## Controleren

1. Meld je aan via de beheerpagina en voeg eventueel een categorie toe of wijzig die.
2. Maak een toekomstige activiteit aan met categorie, capaciteit en status **Gepubliceerd**.
3. Open de openbare agenda, zoek of filter de activiteit en meld je aan.
4. Probeer hetzelfde e-mailadres nogmaals; de server weigert de dubbele actieve aanmelding.
5. Bekijk de deelnemers in beheer en download het CSV-bestand.
6. Annuleer een aanmelding; de vrijgekomen plaats kan opnieuw worden geboekt.
7. Verlaag de capaciteit niet onder het aantal actieve aanmeldingen. Test ook concept-, geannuleerde, volgeboekte en verlopen activiteiten.
8. Open `/api/admin/events` in een uitgelogde browser; de server moet een `401` teruggeven. Een wijzigingsverzoek zonder sessie wordt eveneens geweigerd.
