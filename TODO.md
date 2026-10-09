# Future features

Draft ideas. Nothing here is decided.

## Post missing media links to 1001Tracklists

The decisions can hold a media link (Spotify, YouTube Music, Beatport, other) that the 1001Tracklists track does not have. The page can post such a link as an action.

1001Tracklists shows an "add media link" icon on each track. A click opens a dialog that posts the link. A link posted by hand shows on the track after a reload. The icon calls:

```html
<i class="fa fa-plus-circle fa-24 noUser mAction hOO" title="add media link"
   onclick="cancelBubble(); new MediaSubmitter(this, 'add_media', null, { idObject: 5, idItem: <track-id> } );"></i>
```

`idObject: 5` is a track. `idItem` is the 1001Tracklists track id.

Draft shape:

- `post to 1001` becomes a dialog with more than one action.
- One action posts every decided media link that the 1001Tracklists track lacks.
- Before a post, the action reads the existing links of the track through `GET /ajax/get_medialink.php`, so it never posts a duplicate.
