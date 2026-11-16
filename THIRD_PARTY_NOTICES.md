# Third-party notices and assets

The GPL license and Duff attribution apply to the original material identified
in LICENSE. They do not replace licenses or ownership notices belonging to
other authors. Keep their notices when redistributing their material.

## Software dependencies

The frontend depends on Electron, electron-updater, Koffi and the build tools
pinned in `conquest-launcher/package-lock.json`. The backend depends on .NET 8
and MySqlConnector as declared in its project file. Those components retain
their own licenses. Dependency license/copyright files are authoritative;
install dependencies from their documented upstream sources and preserve the
notices required in your distribution. Do not copy node_modules or SDK/runtime
installations into this source repository.

## Included launcher and builder assets

The current UI images, logos, fonts, sound and builder icons are included under
`conquest-launcher/public/assets/` and `conquest-launcher/public/builder/` so
this source checkout contains the material used by the launcher. Their inclusion
is not a representation that Duff owns every depicted character, game icon,
font or trademark, or that these third-party assets are GPL licensed.

Original assets that Duff owns may be used under the project license. Game
art/icons, third-party logos and fonts retain the rights of their respective
owners. Rights and license provenance for every historical asset have not been
independently established. Do not assume the project license grants unrestricted
reuse of those third-party assets; use assets you have permission to redistribute
when branding your own project. Preserve any accompanying asset notices.

The font filenames include Inter, Cinzel and Beaufort. Do not apply the project
GPL notice to those font files. Consult the actual font licenses for your source
and replace fonts when your distribution does not have the necessary rights.

The addon catalog is optional and empty in this checkout. Addon authors' names,
licenses and notices must be preserved if you supply addon packages yourself.

## Game client and external services

No Ascension/World of Warcraft client executable, Extensions.dll, MPQ/DBC archive,
player data or production authentication keys are included. The code license
is not permission to distribute those files or use another project's private
services. Forks must configure their own services and comply with the rights
applicable to their game/client material.

## SquidBots dashboard (Zyth45)

The Bots page of this edition can download and show the SquidBots dashboard, https://github.com/Zyth45/squidbots-dashboard (a pinned tag; it is not part of this repository). It is MIT licensed:

    MIT License

    Copyright (c) 2026 Zyth45

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## Community addons (Addons tab)

The Addons tab can download and install community addons from their authors' GitHub pages (nothing is bundled in this repository; the list is `conquest-launcher/src/community-addons.json`). The launcher installs only addon files, never programs or scripts, and removes only what it installed. Authors and licences:

- **CoA Item Search** and **CoA Teleports**: ilusixn, https://github.com/ilusixn/coa-item-search and https://github.com/ilusixn/COA-Teleport (author's own addons).
- **Questie-X for CoA**: Questie-X by Xurkon and the Questie team (MIT, copyright Xurkon), https://github.com/Xurkon/Questie-X; CoA compatibility package by Dandenas, https://github.com/Dandenas/coa-questie.
- **ElvUI for CoA**: ElvUI by Elv and Bunny / the Tukui project; CoA build by Paddy187, https://github.com/Paddy187/ElvUI_CoA (no licence file in the package; see the repository).
- **WillItDie**: Joe Greive (MIT, copyright Joe Greive); 3.3.5a port by Duff (Duff-SPP), https://github.com/Duff-SPP/WillItDie---Woltk-Addon-Acension-Coa (installed from one pinned commit).
- **Azeroth_FR** (French translation): LePetitDan and contributors, https://github.com/LePetitDan/Azeroth_FR (MIT for the addon's code; the game texts it displays are not covered by that licence).

Each addon keeps its own licence; see the linked repositories.
