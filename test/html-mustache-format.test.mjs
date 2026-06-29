import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

function template(lines) {
  return `${lines.join('\n')}\n`;
}

async function format(source, options = {}) {
  return prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
    tabWidth: 4,
    ...options,
  });
}

async function assertFormats(source, expected, options = {}) {
  assert.equal(await format(source, options), expected);
  assert.equal(await format(expected, options), expected);
}

test('HTML+Mustache: preserves issue #5 mobile dropdown trigger indentation', async () => {
  const source = template([
    '{{#includeTrigger}}',
    '    <a',
    '        id="drop-down-{{sort}}"',
    '        class="',
    '            list-group-item',
    '            list-group-item-action',
    '            icons-collapse-expand',
    '            collapsed',
    '            d-flex',
    '        "',
    '        href="#"',
    '        data-toggle="collapse"',
    '        data-target="#drop-down-menu-{{sort}}"',
    '        aria-expanded="false"',
    '        aria-controls="drop-down-menu-{{sort}}"',
    '    >',
    '        {{{text}}}',
    '        <span class="ml-auto expanded-icon icon-no-margin mx-2">',
    '            {{#pix}}',
    '                t/expanded, core',
    '            {{/pix}}',
    '            <span class="sr-only">',
    '                {{#str}}',
    '                    collapse, core',
    '                {{/str}}',
    '            </span>',
    '        </span>',
    '    </a>',
    '{{/includeTrigger}}',
  ]);

  const expected = template([
    '{{#includeTrigger}}',
    '    <a',
    '        id="drop-down-{{ sort }}"',
    '        class="',
    '            list-group-item',
    '            list-group-item-action',
    '            icons-collapse-expand',
    '            collapsed',
    '            d-flex',
    '        "',
    '        href="#"',
    '        data-toggle="collapse"',
    '        data-target="#drop-down-menu-{{ sort }}"',
    '        aria-expanded="false"',
    '        aria-controls="drop-down-menu-{{ sort }}"',
    '    >',
    '        {{{ text }}}',
    '        <span class="ml-auto expanded-icon icon-no-margin mx-2">',
    '            {{#pix}}',
    '                t/expanded, core',
    '            {{/pix}}',
    '            <span class="sr-only">',
    '                {{#str}}',
    '                    collapse, core',
    '                {{/str}}',
    '            </span>',
    '        </span>',
    '    </a>',
    '{{/includeTrigger}}',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: keeps Moodle string helper sections nested inside controls', async () => {
  const source = template([
    '<div class="dropdown-menu">',
    '    <a class="dropdown-item" href="#">',
    '        <i',
    '            class="icon fa fa-expand fa-fw"',
    '            aria-hidden="true"',
    '        ></i>',
    '        {{#str}}',
    '            expandall',
    '        {{/str}}',
    '    </a>',
    '    <a class="dropdown-item" href="#">',
    '        <i',
    '            class="icon fa fa-compress fa-fw"',
    '            aria-hidden="true"',
    '        ></i>',
    '        {{#str}}',
    '            collapseall',
    '        {{/str}}',
    '    </a>',
    '</div>',
  ]);

  const expected = source;

  await assertFormats(source, expected);
});

test('HTML+Mustache: preserves nested card markup, partials, and conditional class lines', async () => {
  const source = template([
    '{{#courses}}',
    '    <div',
    '        class="card block mb-3"',
    '        data-search-text="{{searchText}}"',
    '        data-course-id="{{id}}"',
    '    >',
    '        <div class="card-body p-3">',
    '            <div class="float-right">',
    '                {{> block_myoverview/course-action-menu}}',
    '            </div>',
    '            <a href="{{viewurl}}">',
    '                <i',
    '                    class="',
    '                        icon',
    '                        fa',
    '                        fa-star',
    '                        fa-fw',
    '                        {{^isfavourite}}',
    '                            hidden',
    '                        {{/isfavourite}}',
    '                    "',
    '                ></i>',
    '                {{#shortname}}',
    '                    <strong>',
    '                        {{{shortname}}}',
    '                    </strong>',
    '                    <br />',
    '                {{/shortname}}',
    '            </a>',
    '            <small>{{{fullname}}}</small>',
    '        </div>',
    '    </div>',
    '{{/courses}}',
  ]);

  const expected = template([
    '{{#courses}}',
    '    <div',
    '        class="card block mb-3"',
    '        data-search-text="{{ searchText }}"',
    '        data-course-id="{{ id }}"',
    '    >',
    '        <div class="card-body p-3">',
    '            <div class="float-right">',
    '                {{> block_myoverview/course-action-menu }}',
    '            </div>',
    '            <a href="{{ viewurl }}">',
    '                <i',
    '                    class="',
    '                        icon',
    '                        fa',
    '                        fa-star',
    '                        fa-fw',
    '                        {{^isfavourite}}',
    '                            hidden',
    '                        {{/isfavourite}}',
    '                    "',
    '                ></i>',
    '                {{#shortname}}',
    '                    <strong>',
    '                        {{{ shortname }}}',
    '                    </strong>',
    '                    <br />',
    '                {{/shortname}}',
    '            </a>',
    '            <small>{{{ fullname }}}</small>',
    '        </div>',
    '    </div>',
    '{{/courses}}',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: preserves multiline class attributes with conditional sections', async () => {
  const source = template([
    '<button',
    '    type="button"',
    '    class="',
    '        btn',
    '        {{#primary}}',
    '            btn-primary',
    '        {{/primary}}',
    '        {{^primary}}',
    '            btn-secondary',
    '        {{/primary}}',
    '    "',
    '    data-user-id="{{user.id}}"',
    '    aria-label="{{label}}"',
    '>',
    '    {{text}}',
    '</button>',
  ]);

  const expected = template([
    '<button',
    '    type="button"',
    '    class="',
    '        btn',
    '        {{#primary}}',
    '            btn-primary',
    '        {{/primary}}',
    '        {{^primary}}',
    '            btn-secondary',
    '        {{/primary}}',
    '    "',
    '    data-user-id="{{ user.id }}"',
    '    aria-label="{{ label }}"',
    '>',
    '    {{ text }}',
    '</button>',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: formats section-wrapped lists without flattening descendants', async () => {
  const source = template([
    '<ul>',
    '{{#items}}',
    '<li>',
    '<a href="{{url}}">{{name}}</a>',
    '{{#children}}',
    '<span>{{label}}</span>',
    '{{/children}}',
    '</li>',
    '{{/items}}',
    '</ul>',
  ]);

  const expected = template([
    '<ul>',
    '    {{#items}}',
    '        <li>',
    '            <a href="{{ url }}">{{ name }}</a>',
    '            {{#children}}',
    '                <span>{{ label }}</span>',
    '            {{/children}}',
    '        </li>',
    '    {{/items}}',
    '</ul>',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: keeps parent templates and blocks readable when blocks contain HTML', async () => {
  const source = template([
    '{{< theme_boost/drawer}}',
    '    {{$drawerclasses}}{{{classes}}}{{/drawerclasses}}',
    '    {{$drawercontent}}',
    '        <div class="drawer-content">',
    '            {{{content}}}',
    '        </div>',
    '    {{/drawercontent}}',
    '{{/theme_boost/drawer}}',
  ]);

  const expected = template([
    '{{< theme_boost/drawer}}',
    '    {{$drawerclasses}}{{{ classes }}}{{/drawerclasses}}',
    '    {{$drawercontent}}',
    '        <div class="drawer-content">',
    '            {{{ content }}}',
    '        </div>',
    '    {{/drawercontent}}',
    '{{/theme_boost/drawer}}',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: preserves custom delimiters inside HTML sections', async () => {
  const source = template([
    '{{#items}}',
    '    {{=<% %>=}}',
    '    <article id="<%id%>">',
    '        <h2><%title%></h2>',
    '        <p><%description%></p>',
    '    </article>',
    '<%/items%>',
  ]);

  const expected = template([
    '{{#items}}',
    '    {{= <% %> =}}',
    '    <article id="<% id %>">',
    '        <h2><% title %></h2>',
    '        <p><% description %></p>',
    '    </article>',
    '<%/items%>',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: keeps comments and partials aligned inside HTML containers', async () => {
  const source = template([
    '<section class="dashboard">',
    '    {{!Header actions}}',
    '    <header>',
    '        {{> core/action_menu}}',
    '    </header>',
    '    {{#hasCards}}',
    '        {{> core/card_grid}}',
    '    {{/hasCards}}',
    '</section>',
  ]);

  const expected = template([
    '<section class="dashboard">',
    '    {{! Header actions }}',
    '    <header>',
    '        {{> core/action_menu }}',
    '    </header>',
    '    {{#hasCards}}',
    '        {{> core/card_grid }}',
    '    {{/hasCards}}',
    '</section>',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: preserves table markup with nested positive and inverted sections', async () => {
  const source = template([
    '<table>',
    '    <tbody>',
    '        {{#rows}}',
    '            <tr data-id="{{id}}">',
    '                <td>{{label}}</td>',
    '                <td>',
    '                    {{#value}}',
    '                        {{value}}',
    '                    {{/value}}',
    '                    {{^value}}',
    '                        &mdash;',
    '                    {{/value}}',
    '                </td>',
    '            </tr>',
    '        {{/rows}}',
    '    </tbody>',
    '</table>',
  ]);

  const expected = template([
    '<table>',
    '    <tbody>',
    '        {{#rows}}',
    '            <tr data-id="{{ id }}">',
    '                <td>{{ label }}</td>',
    '                <td>',
    '                    {{#value}}',
    '                        {{ value }}',
    '                    {{/value}}',
    '                    {{^value}}',
    '                        &mdash;',
    '                    {{/value}}',
    '                </td>',
    '            </tr>',
    '        {{/rows}}',
    '    </tbody>',
    '</table>',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: preserves void and self-closing tags in conditional content', async () => {
  const source = template([
    '{{#image}}',
    '    <figure class="media">',
    '        <img',
    '            src="{{src}}"',
    '            alt="{{alt}}"',
    '        />',
    '        {{#caption}}',
    '            <figcaption>{{caption}}</figcaption>',
    '        {{/caption}}',
    '    </figure>',
    '{{/image}}',
  ]);

  const expected = template([
    '{{#image}}',
    '    <figure class="media">',
    '        <img',
    '            src="{{ src }}"',
    '            alt="{{ alt }}"',
    '        />',
    '        {{#caption}}',
    '            <figcaption>{{ caption }}</figcaption>',
    '        {{/caption}}',
    '    </figure>',
    '{{/image}}',
  ]);

  await assertFormats(source, expected);
});

test('HTML+Mustache: honors tab indentation without collapsing nested HTML', async () => {
  const source = template([
    '{{#items}}',
    '\t<div>',
    '\t\t<span>{{name}}</span>',
    '\t\t{{#children}}',
    '\t\t\t<a href="{{url}}">{{label}}</a>',
    '\t\t{{/children}}',
    '\t</div>',
    '{{/items}}',
  ]);

  const expected = template([
    '{{#items}}',
    '\t<div>',
    '\t\t<span>{{ name }}</span>',
    '\t\t{{#children}}',
    '\t\t\t<a href="{{ url }}">{{ label }}</a>',
    '\t\t{{/children}}',
    '\t</div>',
    '{{/items}}',
  ]);

  await assertFormats(source, expected, { useTabs: true });
});

test('HTML+Mustache: formats mixed root HTML and standalone sections consistently', async () => {
  const source = template([
    '<main>',
    '{{#title}}',
    '<h1>{{title}}</h1>',
    '{{/title}}',
    '{{^title}}',
    '<h1>{{fallbackTitle}}</h1>',
    '{{/title}}',
    '<p data-user="{{user.id}}">{{message}}</p>',
    '</main>',
  ]);

  const expected = template([
    '<main>',
    '    {{#title}}',
    '        <h1>{{ title }}</h1>',
    '    {{/title}}',
    '    {{^title}}',
    '        <h1>{{ fallbackTitle }}</h1>',
    '    {{/title}}',
    '    <p data-user="{{ user.id }}">{{ message }}</p>',
    '</main>',
  ]);

  await assertFormats(source, expected);
});
