# Contributing Code to Tab Stash

First of all, thanks for your interest in contributing to Tab Stash! Tab Stash
has been a labor of love since 2018, and I never would have expected that N
years later [*what year is it again?*], it would have grown to where it is
today.

Below, I've included some information and resources to help you modify Tab Stash
and submit your change for inclusion in future releases. You'll have an easier
time of it if you already know some JavaScript, but even for those who don't,
I've included a few references to help you get started.

If you plan to make a substantial change or add a new feature, it's best to
start by discussing it on a GitHub issue _before_ you write any code. This
helps to ensure it fits into the overall vision/direction for Tab Stash, and
helps to identify potential issues or roadblocks ahead of time.

Once your change is ready, you'll need to push it to a branch on GitHub and open
a "Pull Request". To maximize the chances of your PR getting merged, there are
a few things you should do before submitting:

1. Include some automated tests verifying your changes behave as expected (if
   applicable).

2. Make sure your PR follows the style and other conventions listed below.

3. Do a "self-review"---read through your own changes as if you were a code
   reviewer, clean up any unnecessary changes (e.g. whitespace-only changes),
   fix any typos, add comments/documentation, etc.

4. Write a detailed/clear summary and description of your PR explaining what
   your change does and why. If you're addressing any GitHub issues, be sure to
   reference them by number in the summary and/or description. Typically you
   would put the issue number in [brackets] at the end of your summary.

Importantly, _don't expect your PR to be merged right away_. You will likely
get at least one round of constructive feedback; this is to help catch bugs and
ensure the code stays maintainable for the next person who wants to contribute.
I hope you will take this feedback in the spirit in which it's given---as
reflecting our shared desire to make Tab Stash the best it can possibly be.

Again, thank you for your interest in contributing!

_--- Josh_

## Before You Start

Before you get started, you may want to spend some time familiarizing yourself
with the tools and technologies Tab Stash is built on. Here are some things
that would be useful to know (or at least references to have handy) when you
dive into the code:

1. If this is your first time coding, here's where to start:

   - [How to develop for the web](https://developer.mozilla.org/en-US/docs/Learn)

2. Learn about the languages used in Tab Stash:

   - [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
   - [TypeScript](https://www.typescriptlang.org/docs/)
   - [HTML](https://developer.mozilla.org/en-US/docs/Web/HTML) for building web
     pages, and
   - [CSS](https://developer.mozilla.org/en-US/docs/Web/CSS) for making them look
     pretty

3. Learn how [extensions for
   Firefox](https://extensionworkshop.com/extension-basics/) are put together.

4. Learn about the major libraries and frameworks used in Tab Stash:

   - [The WebExtension APIs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API)
     (for interacting with the browser)
   - [Vue.js](https://v3.vuejs.org/) (for creating UI elements)
   - [Less](https://lesscss.org/) (for styling)
   - [Vite](https://vitejs.dev/) (for builds)
   - [Mocha](https://mochajs.org/) and [Chai](https://www.chaijs.com/) (for testing)

## Getting Started

Here's how to get a build with your changes loaded into Firefox so you can try
them out:

1. Clone Tab Stash's source code from
   [GitHub](https://github.com/josh-berry/tab-stash/).

2. Follow the instructions in the [README] to build Tab Stash for development.
   You should see that all the tests are passing.

3. Load your build into Firefox:

   1. Go to `about:debugging` and click on "This Firefox".

   2. Click "Load Temporary Addon..." and choose the `manifest.json` file in Tab
      Stash's `dist` directory.

   3. The Tab Stash sidebar and toolbar button should appear.

4. Make your changes:

   1. Use your favorite editor (e.g. [Visual Studio Code]) to make your changes.

   2. Rebuild Tab Stash and run the unit tests (just run `make`). Be sure the
      tests pass before proceeding.

   3. Use `about:debugging` to reload the extension, and try out your changes.
      You can also use `about:debugging` to inspect and debug the various
      components of Tab Stash (background page, UI pages, etc.).

   4. Repeat until you're satisfied with your changes.

5. Once you're happy with your changes, push them to a branch on GitHub, and
   open a Pull Request. (See the introduction for advice on how to submit a
   good PR.)

6. I'll review your change and work with you to address any issues. Then,
   if/when everything looks good, I'll merge it and it will become part of the
   next Tab Stash release!

[readme]: https://github.com/josh-berry/tab-stash/blob/master/README.md
[visual studio code]: https://code.visualstudio.com/

## Learning Your Way Around the Code

During the build, a few different types of source files are combined to produce
the final Tab Stash extension. Let's go on a quick tour:

1. Files in `assets/` are copied directly into the extension unchanged.

   1. `manifest.json` describes the extension to the browser. This is the place
      to start to understand how the browser interacts with Tab Stash.

   2. Each "top-level" part of the Tab Stash UI has an HTML page here as well.
      The HTML pages are pretty minimal, just enough to get things started--most
      of the actual UI code is in `src/`, which we'll get to later.

2. `icons/` contains the SVG icons used throughout the Tab Stash UI. Icons are
   always expected to be monochromatic, and will be re-colored during the build
   to work with both light and dark themes. Some icons are converted to PNG
   images where required by the browser.

3. `styles/` use CSS (as processed by [Less](https://lesscss.org/)) to define
   how the UI looks. In general, styles are broken down as follows:

   - `index.less` is the "top-level" file which loads all the others and acts as
     a "catch-all" for styles that don't fit anywhere else.

   - `theme-*.less` files define colors as CSS variables used throughout the
     styling and source code. (In general, this is the ONLY place where colors
     should be defined.)

   - `metrics-*.less` files define measurements as CSS variables used throughout
     the styling and source code. (In general, this is the ONLY place where
     lengths/measurements should be defined.)

   - All the other `*.less` files describe how to lay out various parts of the
     UI, referring to the colors and lengths/measurements defined in the
     `theme-*` and `metrics-*` files.

4. `src/` is where all the action is---all the TypeScript and Vue.js code that
   makes up Tab Stash lives here. Here are some places to check out to learn
   your way around:

   1. `src/index.ts` is the main entry point for the background page (the part
      of Tab Stash that is always loaded in the background). Integrations with
      the browser (e.g. the context menu, toolbar button, etc.) are all defined
      here, along with several background tasks Tab Stash needs to perform to
      keep things running smoothly.

   2. `src/stash-list/index.ts` is the main entry point for the Tab Stash UI.
      (The same UI is used for all views---sidebar, full page, and popup.) The
      UI itself is defined in the corresponding `src/stash-list/index.vue` file.

   3. Similarly there are entry points for the options page, deleted-items page,
      etc. in the `index.{ts|vue}` files in their respective directories
      (`src/options/`, `src/deleted-items/`, etc.). You can find a list of such
      entry points in the top-level files `vite.config.*.ts`.

   4. Finally, it's worth checking out `src/ui-model.ts` and
      `src/service-model.ts`. `ui-model` constructs the global "model" data
      structure for the UI, and `service-model` does the same for the background
      page. These two files together give an "architectural blueprint" for how
      Tab Stash is organized and how it tracks all the data it needs to do its
      job.

      Each of these files refer to various "models" (which live in `src/model/`)
      that track and modify specific things, such as open tabs, bookmarks,
      deleted items, Tab Stash options, etc. The various models are all used by
      a "root" model (`src/model/index.ts`) which defines the core behaviors of
      Tab Stash (e.g. stashing and unstashing tabs).

There is a lot more to the codebase, but hopefully this is enough to get you
oriented and keep you from getting lost. Most of the rest should be easy to
find by reading code and poking around. And if you do get lost, feel free to
ask a question on GitHub!

## Coding Conventions

_Note:_ The existing code does not always follow these guidelines consistently;
if you find inconsistencies, please feel free to correct them (but please submit
corrections in PRs which are separate from functional changes).

### Naming Things

Try to use clear and descriptive names, but use your best judgment---the larger
the scope, the more carefully you should think about the name. A function that
is used everywhere in the code should have a very clear and descriptive (but not
necessarily long!) name. By contrast, single-letter variable names are fine if
the contents/usage of the variable are obvious in context and the variable's
scope fits on a single (small) screen.

- **Named Constants** are written `LIKE_THIS`.

- **Class Names** are written `LikeThis`.

- **Exported/Public Names** are written `likeThis`. (This applies to functions,
  methods, properties, arguments, global mutable variables.)

- **Private Member and Local Variable Names** are written `like_this`. Private
  members may also have a leading underscore (`_like_this`) to avoid confusion.
  Prefer `const` for local variables when possible, or `let` when necessary.
  Don't use `var`.

### Documentation

- **API Docs:** [JSDoc](https://jsdoc.app/)-style comments (`/** ... */`) should
  be written for exported classes/functions. It is not necessary to write
  formal parameter/return-value/exception documentation unless it helps with
  clarity.

  Documentation should focus on behavior, not implementation---save any
  discussion of the implementation for comments inside the function body. What
  are the _observable effects_ of calling the function (or using the class),
  assuming it is a "black box"? Make sure to note behaviors under edge cases,
  behaviors in the event of a failure, and similar details.

  Avoid discussing the implementation, and especially avoid re-stating the
  purpose of the function/variable/argument/etc, which should be obvious from
  its name. (The worst documentation is something like: `@param timeout The timeout in milliseconds.` Well, duh. Instead, name the parameter something
  like `timeoutMS`, skip the documentation entirely, and save everyone some
  space and time.)

- **Comments:** Comments are encouraged in function bodies, and to provide
  general overview/design notes in modules, classes, etc. As with API
  documentation, avoid re-stating what the code is doing. Instead, focus on
  documenting _your intention_---explain _why_ the code is written the way it
  is, and explicitly state your expectations and assumptions. Use `//`
  comments, not `/* */` comments.

### Formatting

Tab Stash uses Prettier to format everything. Yes, sometimes it makes weird
decisions that look strange or waste a lot of space, but it also removes a lot
of the tedium in making sure your code is formatted consistently. Prettier runs
as part of the build, and it will automatically re-format your code to meet its
standards. If you use Visual Studio Code as your editor, you can install the
Prettier extension and Tab Stash's default project settings will make sure you
rarely have to think about formatting.

## Editing Icons

[Inkscape](https://inkscape.org/en/) is the recommended tool. Please be sure to
follow the Firefox [Photon Design Guide](https://design.firefox.com/photon/).

As noted above, icons must be monochromatic or the post-processing done to
convert icons for light/dark themes will not work well. The post-processing is
very dumb (it's literally just a `sed` command); only fill colors should be used
(no line colors), or the finished result will look weird. If in doubt, follow
the conventions in the existing SVG files.
