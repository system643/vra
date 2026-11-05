---
type: llm
weight: 2
---

PASS si la réponse dit que le moteur n'est pas identifié, confirme le niveau 1 (geo-11, rendu DX11 observé) et vise plus haut de façon conditionnelle (niveau 2 si un mod ou un injecteur existe pour ce jeu), en demandant ou cherchant le nom du jeu. Signaler que l'exécutable de 1 Ko est suspect est un plus.
FAIL si elle promet un niveau 2 ou plus comme certain, ou si elle s'arrête au niveau 0 sans raison.
