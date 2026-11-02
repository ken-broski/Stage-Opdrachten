const form = document.getElementById('taak-form');
const titelInput = document.getElementById('titelbox');
const beschrijvingInput = document.getElementById('beschrijvingbox');
const fout = document.getElementById('fout');
const lijst = document.getElementById('taken-overzicht');
const filterKnoppen = document.querySelectorAll('.filter');

let taken = JSON.parse(localStorage.getItem('taken')) || [];
let actiefFilter = 'alle';
let bewerkId = null;

function opslaan() {
    localStorage.setItem('taken', JSON.stringify(taken));
}

function maak(tag, klas, ...kinderen) {
    const el = document.createElement(tag);
    el.className = klas;
    el.append(...kinderen);
    return el;
}

function maakKnop(tekst, klas, label, actie) {
    const knop = maak('button', klas, tekst);
    knop.type = 'button';
    if (label) knop.setAttribute('aria-label', label);
    knop.addEventListener('click', actie);
    return knop;
}

function wijzig(actie) {
    actie();
    opslaan();
    tonen();
}

function maakVeld(tag, max, waarde, label) {
    const veld = maak(tag, '');
    veld.maxLength = max;
    veld.value = waarde;
    veld.autocomplete = 'off';
    veld.spellcheck = false;
    veld.setAttribute('aria-label', label);
    return veld;
}

function tonen() {
    lijst.innerHTML = '';

    const zichtbaar = taken.filter((t) => actiefFilter === 'alle' || t.klaar === (actiefFilter === 'klaar'));

    if (zichtbaar.length === 0) {
        lijst.append(maak('li', '', 'Geen taken in deze lijst.'));
        return;
    }

    zichtbaar.forEach((taak) => {
        const li = maak('li', taak.klaar ? 'klaar' : '');

        if (taak.id === bewerkId) {
            li.classList.add('bewerken');
            const titelVeld = maakVeld('input', 60, taak.titel, 'Titel bewerken');
            const beschrijvingVeld = maakVeld('textarea', 500, taak.beschrijving, 'Beschrijving bewerken');
            const bewerkFout = maak('p', 'bewerk-fout');
            bewerkFout.setAttribute('role', 'alert');

            li.append(
                maak('div', 'tekst', titelVeld, beschrijvingVeld, bewerkFout),
                maak('div', 'knoppen',
                    maakKnop('Opslaan', 'knop', null, () => {
                        const nieuweTitel = titelVeld.value.trim();
                        if (nieuweTitel === '') {
                            bewerkFout.textContent = 'Vul een titel in.';
                            return;
                        }
                        wijzig(() => {
                            taak.titel = nieuweTitel;
                            taak.beschrijving = beschrijvingVeld.value.trim();
                            bewerkId = null;
                        });
                    }),
                    maakKnop('Annuleren', 'knop', null, () => {
                        bewerkId = null;
                        tonen();
                    })
                )
            );
            lijst.append(li);
            titelVeld.focus();
            return;
        }

        li.append(
            maak('div', 'tekst', maak('div', 'titel', taak.titel), maak('div', '', taak.beschrijving)),
            maak('div', 'knoppen',
                maakKnop(
                    taak.klaar ? 'Heropenen' : 'Afgerond',
                    'knop',
                    (taak.klaar ? 'Taak heropenen: ' : 'Taak afronden: ') + taak.titel,
                    () => wijzig(() => { taak.klaar = !taak.klaar; })
                ),
                maakKnop('Bewerken', 'knop', 'Taak bewerken: ' + taak.titel, () => {
                    bewerkId = taak.id;
                    tonen();
                }),
                maakKnop('Verwijderen', 'knop knop-verwijder', 'Taak verwijderen: ' + taak.titel, () =>
                    wijzig(() => { taken = taken.filter((t) => t.id !== taak.id); })
                )
            )
        );
        lijst.append(li);
    });
}

function zetFilter(naam) {
    actiefFilter = naam;
    filterKnoppen.forEach((k) => {
        const isActief = k.dataset.filter === naam;
        k.classList.toggle('actief', isActief);
        k.setAttribute('aria-pressed', isActief);
    });
    tonen();
}

form.addEventListener('submit', (e) => {
    e.preventDefault();

    const titel = titelInput.value.trim();
    if (titel === '') {
        fout.textContent = 'Vul een titel in.';
        return;
    }
    fout.textContent = '';

    taken.push({ id: Date.now(), titel, beschrijving: beschrijvingInput.value.trim(), klaar: false });
    opslaan();
    form.reset();
    zetFilter('alle');
});

filterKnoppen.forEach((knop) => {
    knop.addEventListener('click', () => zetFilter(knop.dataset.filter));
});

zetFilter('alle');

document.querySelectorAll('input, textarea, [contenteditable]').forEach(el => {
  el.spellcheck = false;
});