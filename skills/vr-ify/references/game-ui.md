# Piloter l'interface du jeu

Pour tester vite, Claude doit pouvoir aller seul du lancement jusqu'au jeu : cliquer « Nouvelle partie », passer les
écrans de titre, choisir une sauvegarde, taper un nom. Les outils `game_ui_*` le font **dans la fenêtre du jeu uniquement**.

| Outil | Rôle |
| --- | --- |
| `game_ui_look` | Capture de la fenêtre (à regarder avec Read) + texte lu par l'OCR intégré à Windows, avec positions |
| `game_ui_click` | Clic sur un texte visible (`text: "Nouvelle partie"`, insensible aux accents et à la casse) ou à des coordonnées de la capture |
| `game_ui_key` | Touches : `enter`, `esc`, `space`, `up/down/left/right`, `f1…f12`, lettres, combinaisons `ctrl+s`, maintien `hold_ms` |
| `game_ui_type` | Taper du texte (nom de profil, de sauvegarde) |
| `game_ui_wait_text` | Attendre la fin d'un chargement ou l'arrivée d'un menu |
| `game_ui_recipe` | Recette « lancement → en jeu » : enregistrée automatiquement en brouillon, `save` pour la garder, `run` pour la rejouer |

Méthode :
1. `game_ui_look` → lire le texte et regarder la capture.
2. Naviguer avec `game_ui_click` / `game_ui_key` / `game_ui_wait_text` jusqu'au jeu.
3. `game_ui_recipe action=save` : la recette est rejouée automatiquement par `lab_launch` et à chaque relance après
   plantage dans `lab_matrix`. Dans un scénario, une étape `{ "op": "ui", "step": { "do": "click_text", "text": "Continuer" } }`.
4. Menus graphiques sans texte (icônes) : regarder la capture et cliquer par coordonnées (pixels de la capture).

Règles de sécurité (appliquées par l'outil lui-même) :
- Les actions ne partent que si la **fenêtre du jeu est au premier plan** ; sinon elles sont refusées.
- Si l'utilisateur **bouge la souris**, l'automatisation s'arrête aussitôt (il reprend la main).
- Refusé si un anti-cheat est détecté. Jamais d'automatisation de parties en ligne contre d'autres joueurs.
- Ne jamais valider d'achat, d'abonnement ou de conditions d'utilisation à la place de l'utilisateur : s'arrêter et demander.

Limites : jeux en plein écran exclusif (préférer fenêtré ou plein écran fenêtré), menus dessinés sans texte lisible
(passer par la capture et les coordonnées), lanceurs d'éditeur séparés (cibler la fenêtre du lanceur puis du jeu).
