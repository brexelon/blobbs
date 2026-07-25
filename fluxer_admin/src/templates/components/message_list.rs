// SPDX-License-Identifier: AGPL-3.0-or-later

use maud::{Markup, PreEscaped, html};
use serde_json::Value;
use std::cmp::Ordering;

use super::icons::paperclip_icon;
use super::media::user_avatar_url;
use super::nsfw_indicators::{attachment_nsfw_badge, channel_nsfw_state_badge};
use super::user_display::format_user_display;
use crate::config::AdminConfig;

pub struct Attachment {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub nsfw: Option<bool>,
    pub content_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size: Option<u64>,
    pub ncmec_status: String,
    pub ncmec_report_id: Option<String>,
    pub ncmec_failure_reason: Option<String>,
}

pub struct Message {
    pub id: String,
    pub content: String,
    pub timestamp: String,
    pub author_id: String,
    pub author_username: String,
    pub author_global_name: Option<String>,
    pub author_discriminator: String,
    pub author_avatar: Option<String>,
    pub channel_id: String,
    pub channel_nsfw: Option<bool>,
    pub channel_content_warning_level: Option<i32>,
    pub channel_content_warning_text: Option<String>,
    pub guild_nsfw: Option<bool>,
    pub attachments: Vec<Attachment>,
    /// Message type. Anything other than DEFAULT/REPLY is a system message whose
    /// text is derived rather than stored in `content`.
    pub message_type: i32,
    pub thread_id: Option<String>,
    pub thread_name: Option<String>,
    pub mentions: Vec<MessageMention>,
}

/// A user named by a system message. Rendered as plain text here rather than as a
/// mention pill.
#[derive(Clone, Debug)]
pub struct MessageMention {
    pub id: String,
    pub username: String,
    pub global_name: Option<String>,
}

impl MessageMention {
    pub fn display_name(&self) -> &str {
        self.global_name
            .as_deref()
            .filter(|name| !name.is_empty())
            .unwrap_or(&self.username)
    }
}

fn is_image(att: &Attachment) -> bool {
    att.content_type
        .as_deref()
        .is_some_and(|ct| ct.starts_with("image/"))
}

fn ncmec_badge(att: &Attachment) -> Markup {
    match att.ncmec_status.as_str() {
        "submitted" => {
            let label = att
                .ncmec_report_id
                .as_deref()
                .map(|id| format!("NCMEC {id}"))
                .unwrap_or_else(|| "Reported to NCMEC".into());
            html! {
                span class="rounded bg-green-100 px-2 py-0.5 text-[11px] text-green-800"
                     title=(label) { (label) }
            }
        }
        "failed" => {
            let title = att
                .ncmec_failure_reason
                .as_deref()
                .unwrap_or("NCMEC report failed");
            html! {
                span class="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-800"
                     title=(title) { "NCMEC Failed" }
            }
        }
        _ => html! {},
    }
}

fn render_image_attachments(msg: &Message, include_delete: bool) -> Markup {
    let images: Vec<&Attachment> = msg.attachments.iter().filter(|a| is_image(a)).collect();
    if images.is_empty() {
        return html! {};
    }
    let spacer = if !msg.content.is_empty() {
        "mt-2 space-y-3"
    } else {
        "mt-1 space-y-3"
    };
    html! {
        div class=(spacer) {
            @for att in &images {
                div class="max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50" {
                    a href=(att.url) target="_blank" rel="noopener noreferrer"
                      class="block overflow-hidden bg-neutral-100" {
                        img src=(att.url) alt=(att.filename) loading="lazy"
                            class="block max-h-96 w-full scale-110 object-contain blur-2xl \
                                   transition-[filter,transform] duration-150 \
                                   hover:scale-100 hover:blur-none";
                    }
                    div class="space-y-2 p-3" {
                        div class="flex flex-wrap items-center gap-2 text-xs" {
                            a href=(att.url) target="_blank" rel="noopener noreferrer"
                              class="font-medium text-blue-600 hover:underline" { (att.filename) }
                            (attachment_nsfw_badge(att.nsfw.unwrap_or(false)))
                            (ncmec_badge(att))
                        }
                        @if include_delete {
                            div class="flex flex-wrap gap-2" {
                                button type="button"
                                    class="delete-message-btn rounded bg-white px-2.5 py-1 \
                                           text-red-600 text-xs shadow-sm ring-1 ring-neutral-200 \
                                           transition-colors hover:bg-red-50 hover:text-red-700"
                                    data-channel-id=(msg.channel_id)
                                    data-message-id=(msg.id) { "Delete" }
                                button type="button"
                                    class="ncmec-report-btn rounded bg-white px-2.5 py-1 text-xs \
                                           shadow-sm ring-1 ring-neutral-200 transition-colors \
                                           hover:bg-neutral-100 disabled:cursor-not-allowed \
                                           disabled:opacity-70"
                                    data-channel-id=(msg.channel_id)
                                    data-message-id=(msg.id)
                                    data-attachment-id=(att.id)
                                    data-filename=(att.filename)
                                    data-content-type=(att.content_type.as_deref().unwrap_or(""))
                                    data-size=(att.size.map(|s| s.to_string()).unwrap_or_default())
                                    data-author-id=(msg.author_id)
                                    data-ncmec-status=(att.ncmec_status)
                                    data-ncmec-report-id=(att.ncmec_report_id.as_deref().unwrap_or(""))
                                    disabled[att.ncmec_status == "submitted"]
                                    title=(if att.ncmec_status == "submitted" {
                                        "Already reported to NCMEC"
                                    } else {
                                        "Report this image to NCMEC"
                                    }) {
                                    @if att.ncmec_status == "submitted" {
                                        "Reported to NCMEC"
                                    } @else {
                                        "Report to NCMEC"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn render_other_attachments(msg: &Message, has_content_or_images: bool) -> Markup {
    let others: Vec<&Attachment> = msg.attachments.iter().filter(|a| !is_image(a)).collect();
    if others.is_empty() {
        return html! {};
    }
    let spacer = if has_content_or_images {
        "mt-1.5 space-y-1"
    } else {
        "space-y-1"
    };
    html! {
        div class=(spacer) {
            @for att in &others {
                div class="flex flex-wrap items-center gap-2 text-xs" {
                    (paperclip_icon("text-neutral-400"))
                    a href=(att.url) target="_blank" rel="noopener noreferrer"
                      class="text-blue-600 hover:underline" { (att.filename) }
                    (attachment_nsfw_badge(att.nsfw.unwrap_or(false)))
                    (ncmec_badge(att))
                }
            }
        }
    }
}

const MESSAGE_TYPE_DEFAULT: i32 = 0;
const MESSAGE_TYPE_RECIPIENT_ADD: i32 = 1;
const MESSAGE_TYPE_RECIPIENT_REMOVE: i32 = 2;
const MESSAGE_TYPE_CALL: i32 = 3;
const MESSAGE_TYPE_CHANNEL_NAME_CHANGE: i32 = 4;
const MESSAGE_TYPE_CHANNEL_ICON_CHANGE: i32 = 5;
const MESSAGE_TYPE_CHANNEL_PINNED_MESSAGE: i32 = 6;
const MESSAGE_TYPE_USER_JOIN: i32 = 7;
const MESSAGE_TYPE_THREAD_CREATED: i32 = 18;
const MESSAGE_TYPE_REPLY: i32 = 19;
const MESSAGE_TYPE_THREAD_MEMBER_REMOVE: i32 = 20;

/// Whether the message's body is derived from its type rather than stored in
/// `content`. Replies are ordinary messages that merely reference another one.
pub fn is_system_message(message_type: i32) -> bool {
    message_type != MESSAGE_TYPE_DEFAULT && message_type != MESSAGE_TYPE_REPLY
}

fn author_display(msg: &Message) -> &str {
    msg.author_global_name
        .as_deref()
        .filter(|name| !name.is_empty())
        .unwrap_or(&msg.author_username)
}

/// Link to an admin surface for a resource named inside a system message. Only the
/// resource itself is linked; the surrounding wording stays plain text.
const SYSTEM_LINK_CLASS: &str = "font-medium text-blue-600 not-italic hover:underline";

fn system_user_link(base_path: &str, id: &str, name: &str) -> Markup {
    html! {
        a href={(base_path) "/users/" (id)} class=(SYSTEM_LINK_CLASS) title=(id) { (name) }
    }
}

fn system_channel_link(base_path: &str, id: &str, name: &str) -> Markup {
    html! {
        a href={(base_path) "/messages?channel_id=" (id)} class=(SYSTEM_LINK_CLASS) title=(id) {
            (name)
        }
    }
}

/// Rendering of a system message, mirroring what the app shows in the channel. Each
/// user, channel, and thread it names links to that resource's admin page; the rest
/// is plain text. Falls back to naming the type so an unrecognised one still reads
/// as something rather than as an empty row.
fn system_message_body(base_path: &str, msg: &Message) -> Markup {
    let author = system_user_link(base_path, &msg.author_id, author_display(msg));
    let mentioned = msg.mentions.first();
    let mentioned_link =
        mentioned.map(|user| system_user_link(base_path, &user.id, user.display_name()));
    match msg.message_type {
        MESSAGE_TYPE_USER_JOIN => html! { (author) " joined the community." },
        MESSAGE_TYPE_CHANNEL_PINNED_MESSAGE => html! {
            (author) " pinned a message to "
            (system_channel_link(base_path, &msg.channel_id, "this channel"))
            "."
        },
        MESSAGE_TYPE_RECIPIENT_ADD => match mentioned_link {
            Some(user) => html! { (author) " added " (user) " to the group." },
            None => html! { (author) " added someone to the group." },
        },
        MESSAGE_TYPE_RECIPIENT_REMOVE => match (mentioned, mentioned_link) {
            (Some(user), _) if user.id == msg.author_id => html! { (author) " left the group." },
            (_, Some(user)) => html! { (author) " removed " (user) " from the group." },
            _ => html! { (author) " removed someone from the group." },
        },
        MESSAGE_TYPE_CHANNEL_NAME_CHANGE => {
            if msg.content.is_empty() {
                html! { (author) " changed the channel name." }
            } else {
                html! {
                    (author) " changed the channel name to "
                    (system_channel_link(base_path, &msg.channel_id, &msg.content))
                    "."
                }
            }
        }
        MESSAGE_TYPE_CHANNEL_ICON_CHANGE => html! { (author) " changed the channel icon." },
        MESSAGE_TYPE_CALL => html! { (author) " started a call." },
        MESSAGE_TYPE_THREAD_CREATED => {
            let name = msg.thread_name.as_deref().filter(|name| !name.is_empty());
            match (msg.thread_id.as_deref(), name) {
                (Some(id), Some(name)) => html! {
                    (author) " started a thread: " (system_channel_link(base_path, id, name)) "."
                },
                (None, Some(name)) => html! { (author) " started a thread: " (name) "." },
                _ => html! { (author) " started a thread." },
            }
        }
        MESSAGE_TYPE_THREAD_MEMBER_REMOVE => match mentioned_link {
            Some(user) => html! { (author) " removed " (user) " from the thread." },
            None => html! { (author) " removed someone from the thread." },
        },
        other => html! { "System message (type " (other) ")" },
    }
}

/// System messages are rendered as a single muted line without an avatar, so they
/// read as channel events rather than as content someone wrote.
fn system_message_row(
    base_path: &str,
    msg: &Message,
    include_delete: bool,
    is_highlighted: bool,
) -> Markup {
    let highlight = if is_highlighted {
        " rounded-lg bg-amber-100/90 ring-1 ring-inset ring-amber-300/90 shadow-sm"
    } else {
        ""
    };
    let row_class = format!(
        "group relative mt-2 py-1 pr-4 pl-4 transition-colors first:mt-0 \
         hover:bg-neutral-800/[.04]{highlight}"
    );
    html! {
        div class=(row_class)
            style="display:grid;grid-template-columns:16px 40px 16px minmax(0,1fr);"
            data-message-id=(msg.id) data-message-row="" {
            div class="flex items-center justify-center text-neutral-400"
                style="grid-row:1;grid-column:2;" { "\u{2726}" }
            div class="min-w-0" style="grid-column:4;" {
                div class="flex flex-wrap items-baseline gap-2" {
                    span class="text-neutral-600 text-sm italic" {
                        (system_message_body(base_path, msg))
                    }
                    span class="text-neutral-400 text-xs" { (msg.timestamp) }
                    span class="text-neutral-300 text-xs" { (msg.id) }
                }
            }
            @if include_delete {
                div class="absolute top-0 right-2 hidden group-hover:block" {
                    button type="button"
                        class="delete-message-btn rounded bg-white px-2 py-0.5 \
                               text-red-600 text-xs shadow-sm ring-1 ring-neutral-200 \
                               transition-colors hover:bg-red-50 hover:text-red-700"
                        data-channel-id=(msg.channel_id)
                        data-message-id=(msg.id) { "Delete" }
                }
            }
        }
    }
}

fn message_row(
    base_path: &str,
    avatar_url: &str,
    msg: &Message,
    include_delete: bool,
    is_highlighted: bool,
    is_grouped: bool,
) -> Markup {
    if is_system_message(msg.message_type) {
        return system_message_row(base_path, msg, include_delete, is_highlighted);
    }
    let hover = if is_highlighted {
        " hover:bg-amber-100"
    } else {
        " hover:bg-neutral-800/[.04]"
    };
    let highlight = if is_highlighted {
        " rounded-lg bg-amber-100/90 ring-1 ring-inset ring-amber-300/90 shadow-sm"
    } else {
        ""
    };
    let has_images = msg.attachments.iter().any(is_image);
    let has_content_or_images = !msg.content.is_empty() || has_images;

    if is_grouped {
        let row_class =
            format!("group relative py-0.5 pr-4 pl-4 transition-colors{hover}{highlight}");
        return html! {
            div class=(row_class)
                style="display:grid;grid-template-columns:16px 40px 16px minmax(0,1fr);\
                       min-height:1.375rem;"
                data-message-id=(msg.id) data-message-row="" {
                div style="grid-column:1/span 3;" {}
                div class="min-w-0" style="grid-column:4;" {
                    @if !msg.content.is_empty() {
                        div class="whitespace-pre-wrap break-words text-neutral-800 \
                                   text-sm leading-snug" { (msg.content) }
                    }
                    @if !msg.attachments.is_empty() {
                        (render_image_attachments(msg, include_delete))
                        (render_other_attachments(msg, has_content_or_images))
                    }
                    @if include_delete && !has_images {
                        div class="absolute top-0 right-2 hidden group-hover:block" {
                            button type="button"
                                class="delete-message-btn rounded bg-white px-2 py-0.5 \
                                       text-red-600 text-xs shadow-sm ring-1 ring-neutral-200 \
                                       transition-colors hover:bg-red-50 hover:text-red-700"
                                data-channel-id=(msg.channel_id)
                                data-message-id=(msg.id) { "Delete" }
                        }
                    }
                }
            }
        };
    }

    let tag = format_user_display(
        msg.author_global_name.as_deref(),
        Some(&msg.author_username),
        None,
    );
    let row_class = format!(
        "group relative mt-4 py-0.5 pr-4 pl-4 transition-colors first:mt-0{hover}{highlight}"
    );
    html! {
        div class=(row_class)
            style="display:grid;grid-template-columns:16px 40px 16px minmax(0,1fr);"
            data-message-id=(msg.id) data-message-row="" {
            div style="grid-row:1;grid-column:1;" {}
            a href={(base_path) "/users/" (msg.author_id)}
              title=(msg.author_id) class="block flex-shrink-0"
              style="grid-row:1;grid-column:2;align-self:start;" {
                img src=(avatar_url) alt=(msg.author_username)
                    class="rounded-full" style="width:40px;height:40px;";
            }
            div style="grid-row:1;grid-column:3;" {}
            div class="min-w-0" style="grid-column:4;" {
                div class="flex items-baseline gap-2" {
                    a href={(base_path) "/users/" (msg.author_id)}
                      class="font-medium text-neutral-900 text-sm hover:underline"
                      title=(msg.author_id) { (tag) }
                    span class="text-neutral-400 text-xs" {
                        " \u{2014} " (msg.timestamp)
                    }
                    (channel_nsfw_state_badge(
                        msg.channel_nsfw.unwrap_or(false),
                        None, None, msg.guild_nsfw,
                        msg.channel_content_warning_level,
                        msg.channel_content_warning_text.as_deref(),
                        true,
                    ))
                }
                @if !msg.content.is_empty() {
                    div class="mt-0.5 whitespace-pre-wrap break-words text-neutral-800 \
                               text-sm leading-snug" { (msg.content) }
                }
                @if !msg.attachments.is_empty() {
                    (render_image_attachments(msg, include_delete))
                    (render_other_attachments(msg, has_content_or_images))
                }
                div class="mt-1 text-neutral-400 text-xs" {
                    span class="" { (msg.id) }
                }
            }
            @if include_delete && !has_images {
                div class="absolute top-1 right-2 hidden group-hover:block" {
                    button type="button"
                        class="delete-message-btn rounded bg-white px-2 py-0.5 \
                               text-red-600 text-xs shadow-sm ring-1 ring-neutral-200 \
                               transition-colors hover:bg-red-50 hover:text-red-700"
                        data-channel-id=(msg.channel_id)
                        data-message-id=(msg.id) { "Delete" }
                }
            }
        }
    }
}

pub fn message_list(
    config: &AdminConfig,
    base_path: &str,
    messages: &[Message],
    include_delete: bool,
    highlight_message_id: Option<&str>,
) -> Markup {
    html! {
        div class="divide-y-0" {
            @for (i, msg) in messages.iter().enumerate() {
                // A system message stands on its own, and never lets the message after
                // it hide its author header by grouping onto it.
                @let is_grouped = i > 0
                    && messages[i - 1].author_id == msg.author_id
                    && !is_system_message(messages[i - 1].message_type)
                    && !is_system_message(msg.message_type);
                @let is_highlighted = highlight_message_id == Some(msg.id.as_str());
                @let avatar_url = user_avatar_url(
                    config, &msg.author_id, msg.author_avatar.as_deref(), 160, true,
                );
                (message_row(
                    base_path, &avatar_url, msg,
                    include_delete, is_highlighted, is_grouped,
                ))
            }
        }
    }
}

pub fn message_deletion_script(csrf_token: &str) -> Markup {
    let csrf = serde_json::to_string(csrf_token).unwrap_or_else(|_| "\"\"".into());
    let script = r#"(function() {
    var csrf = __CSRF__;
    function bp() {
        return document.documentElement.dataset.basePath || '';
    }
    function toast(level, message) {
        document.body.dispatchEvent(new CustomEvent('showFlash', {detail: {level: level, message: message}}));
    }
    function post(action, fields) {
        fields.append('_csrf', csrf);
        return fetch(bp() + '/messages?action=' + action, {
            method: 'POST',
            body: fields,
            credentials: 'same-origin',
            headers: {'x-csrf-token': csrf}
        });
    }
    function deleteMessage(b) {
        var fields = new URLSearchParams();
        fields.append('channel_id', b.dataset.channelId || '');
        fields.append('message_id', b.dataset.messageId || '');
        b.disabled = true;
        b.textContent = 'Deleting...';
        toast('info', 'Deleting message...');
        post('delete', fields).then(function(r) {
            if (!r.ok) throw new Error('Failed');
            var row = b.closest('[data-message-id]');
            if (row) {
                row.style.opacity = '0.5';
                row.style.pointerEvents = 'none';
            }
            b.textContent = 'Deleted';
            toast('success', 'Message deleted.');
        }).catch(function() {
            b.disabled = false;
            b.textContent = 'Delete';
            toast('error', 'Failed to delete message.');
        });
    }
    function reportNcmec(b) {
        var name = prompt('Type your full name to confirm you personally viewed this image and want to submit it to NCMEC.');
        if (!name || !name.trim()) return;
        var fields = new URLSearchParams();
        fields.append('channel_id', b.dataset.channelId || '');
        fields.append('message_id', b.dataset.messageId || '');
        fields.append('attachment_id', b.dataset.attachmentId || '');
        fields.append('filename', b.dataset.filename || '');
        fields.append('reporter_full_name', name.trim());
        fields.append('confirmed_viewed', 'true');
        b.disabled = true;
        b.textContent = 'Reporting...';
        toast('info', 'Submitting NCMEC report...');
        post('report-to-ncmec', fields).then(function(r) {
            return r.json().catch(function() {
                return null;
            }).then(function(data) {
                if (!r.ok || !data || data.success !== true) throw new Error(data && (data.error || data.message) || 'Failed to report attachment to NCMEC');
                return data;
            });
        }).then(function(data) {
            b.textContent = 'Reported to NCMEC';
            b.dataset.ncmecStatus = 'submitted';
            if (data.ncmec_report_id) b.dataset.ncmecReportId = data.ncmec_report_id;
            toast('success', 'NCMEC report submitted.');
        }).catch(function(err) {
            b.disabled = false;
            b.textContent = 'Report to NCMEC';
            toast('error', err && err.message ? err.message : 'Failed to report attachment to NCMEC.');
        });
    }
    document.addEventListener('click', function(e) {
        var t = e.target;
        if (!(t instanceof HTMLElement)) return;
        var d = t.closest('.delete-message-btn');
        if (d instanceof HTMLButtonElement) {
            e.preventDefault();
            deleteMessage(d);
            return;
        }
        var n = t.closest('.ncmec-report-btn');
        if (n instanceof HTMLButtonElement && !n.disabled) {
            e.preventDefault();
            reportNcmec(n);
        }
    });
})();"#
    .replace("__CSRF__", &csrf);
    html! {
        script defer { (PreEscaped(script)) }
    }
}

/// Shared JSON parsing for the admin message shape returned by the message
/// lookup, browse, and report endpoints. Both pages that render messages build
/// them through here so the two stay in step.
pub fn message_from_value(value: &Value) -> Message {
    let attachments = value
        .get("attachments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(attachment_from_value)
        .collect();
    Message {
        id: value.get("id").and_then(value_id).unwrap_or_default(),
        content: value
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        timestamp: value
            .get("timestamp")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        author_id: value
            .get("author_id")
            .and_then(value_id)
            .unwrap_or_default(),
        author_username: value
            .get("author_username")
            .and_then(Value::as_str)
            .unwrap_or("Unknown")
            .to_owned(),
        author_global_name: value
            .get("author_global_name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        author_discriminator: value
            .get("author_discriminator")
            .and_then(value_id)
            .unwrap_or_else(|| "0000".to_owned()),
        author_avatar: value
            .get("author_avatar")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        channel_id: value
            .get("channel_id")
            .and_then(value_id)
            .unwrap_or_default(),
        channel_nsfw: value.get("channel_nsfw").and_then(Value::as_bool),
        channel_content_warning_level: value
            .get("channel_content_warning_level")
            .and_then(Value::as_i64)
            .map(|n| n as i32),
        channel_content_warning_text: value
            .get("channel_content_warning_text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        guild_nsfw: value.get("guild_nsfw").and_then(Value::as_bool),
        attachments,
        message_type: value.get("type").and_then(Value::as_i64).unwrap_or(0) as i32,
        thread_id: value.get("thread_id").and_then(value_id),
        thread_name: value
            .get("thread_name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        mentions: value
            .get("mentions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(mention_from_value)
            .collect(),
    }
}

fn mention_from_value(value: &Value) -> MessageMention {
    MessageMention {
        id: value.get("id").and_then(value_id).unwrap_or_default(),
        username: value
            .get("username")
            .and_then(Value::as_str)
            .unwrap_or("Unknown")
            .to_owned(),
        global_name: value
            .get("global_name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    }
}

fn attachment_from_value(value: &Value) -> Attachment {
    Attachment {
        id: value.get("id").and_then(value_id).unwrap_or_default(),
        url: value
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        filename: value
            .get("filename")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        nsfw: value.get("nsfw").and_then(Value::as_bool),
        content_type: value
            .get("content_type")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        width: value.get("width").and_then(Value::as_u64).map(|n| n as u32),
        height: value
            .get("height")
            .and_then(Value::as_u64)
            .map(|n| n as u32),
        size: value.get("size").and_then(Value::as_u64),
        ncmec_status: value
            .get("ncmec_status")
            .and_then(Value::as_str)
            .unwrap_or("not_submitted")
            .to_owned(),
        ncmec_report_id: value
            .get("ncmec_report_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        ncmec_failure_reason: value
            .get("ncmec_failure_reason")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    }
}

pub fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn compare_message_ids(left: &Message, right: &Message) -> Ordering {
    match (left.id.parse::<u128>(), right.id.parse::<u128>()) {
        (Ok(l), Ok(r)) => l.cmp(&r),
        _ => left.id.cmp(&right.id),
    }
}
