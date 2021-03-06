window.onerror = function (msg, url, line, column, err) {
    var msgError = msg + " in " + url + " (line: " + line + ")";
    console.error(msgError);

    if (!Settings.get("isDebug")) {
        CPA.sendEvent("Errors", chrome.runtime.getManifest().version, {
            msg: msg,
            url: url,
            line: line,
            trace: err && err.stack || ""
        });
    }
};

parallel({
    dom: function (callback) {
        document.addEventListener("DOMContentLoaded", callback, false);
    },
    settings: function (callback) {
        Settings.load(callback);
    }
}, function (res) {
    "use strict";

    var changeVolumeTimeoutId;

    var evtHandlers = [
        // sendStat checkbox on guest page
        {
            selector: "input[name='sendStat']",
            evtType: "click",
            callback: function () {
                CPA.changePermittedState(this.checked);
            }
        },
        // authorization button on guest page
        {
            selector: ".auth",
            evtType: "click",
            callback: function (evt) {
                var btn = this;
                var initialText = this.html();

                this.disabled = "disabled";
                this.html(chrome.i18n.getMessage("wait") + "...");
                var baseURL = "https://" + chrome.runtime.id + ".chromiumapp.org/cb";

                chrome.identity.launchWebAuthFlow({
                    url: "https://oauth.vk.com/authorize?" + createRequestParams({
                        client_id: Config.constants.vk_app_id,
                        scope: Config.constants.vk_app_scope.join(","),
                        redirect_uri: baseURL,
                        display: "page",
                        v: "5.0",
                        response_type: "token"
                    }),
                    interactive: true
                }, function (responseURL) {
                    btn.removeAttr("disabled").html(initialText);

                    if (!responseURL)
                        return;

                    var response = parseQuery(responseURL.replace(baseURL + "#", ""));
                    if (!response.access_token)
                        return;

                    Settings.set("vkToken", response.access_token);
                    Settings.set("vkUID", parseInt(response.user_id, 10));

                    // @todo redraw every page
                    Navigation.dispatch("user");
                });
            }
        },
        // install google chrome for mp3-missing browsers
        {
            selector: ".googlechrome",
            evtType: "click",
            callback: function (evt) {
                window.open("https://www.google.com/chrome");
                chrome.management.uninstallSelf();
            }
        },
        // opening settings UI
        {
            selector: "header .header-settings",
            evtType: "click",
            callback: function (evt) {
                Navigation.dispatch("settings");
            }
        },
        // opening changelog
        {
            selector: "header .header-news",
            evtType: "click",
            callback: function (evt) {
                Navigation.dispatch("news");
            }
        },
        // Google Drive synchronized tracks
        {
            selector: "header .header-local",
            evtType: "click",
            callback: function (evt) {
                Navigation.dispatch("cloud");
            }
        },
        // go back to the previous app view
        {
            selector: "header .header-navback",
            evtType: "click",
            callback: function (evt) {
                Navigation.back();
            }
        },
        // go to the next app view
        {
            selector: "header .header-navforward",
            evtType: "click",
            callback: function (evt) {
                Navigation.forward();
            }
        },
        // show own audio
        {
            selector: "header .header-home",
            evtType: "click",
            callback: function (evt) {
                Navigation.dispatch("current");
            }
        },
        // search for bands, albums, songs etc
        {
            selector: "header .search",
            evtType: "click",
            callback: function (evt) {
                var searchElem = $("header input[type='search']");
                var searchQuery = searchElem.val();
                var matches;

                if (!navigator.onLine)
                    return Navigation.dispatch("cloud");

                if (!searchQuery.length)
                    return Navigation.dispatch("current");

                matches = searchQuery.match(/^artist:(.+)/);
                if (matches)
                    return Navigation.dispatch("searchArtist", {artist: matches[1]});

                var mbid = searchElem.data("mbid");
                var ymid = searchElem.data("ymid");
                var artist = searchElem.data("artist");
                var album = searchElem.data("album");

                if (mbid.length)
                    return Navigation.dispatch("searchAlbum", {mbid: mbid, searchQuery: searchQuery});

                if (ymid.length)
                    return Navigation.dispatch("searchAlbum", {ymid: ymid, searchQuery: searchQuery});

                if (artist.length && album.length)
                    return Navigation.dispatch("searchAlbum", {artist: artist, album: album, searchQuery: searchQuery});

                CPA.increaseCustomStat("push-search");
                Navigation.dispatch("search", {searchQuery: searchQuery});
            }
        },
        // close pay layer with "close" link
        {
            selector: ".pay .pay-close",
            evtType: "click",
            callback: function (evt) {
                var headerOverlayActions = Settings.get("headerOverlayActions");
                headerOverlayActions.close += 1;
                Settings.set("headerOverlayActions", headerOverlayActions);

                Settings.set("headerRateCounter", 0);
                this.closestParent("div.pay").remove();

                evt.stopImmediatePropagation();
            }
        },
        // close pay layer with "Rate CWS" button
        {
            selector: ".pay .pay-cwsrate",
            evtType: "click",
            callback: function (evt) {
                var headerOverlayActions = Settings.get("headerOverlayActions");
                headerOverlayActions.ratecws += 1;
                Settings.set("headerOverlayActions", headerOverlayActions);

                window.open(Config.constants.cws_app_link + "/reviews");

                Settings.set("headerRateCounter", 0);
                this.closestParent("div.pay").remove();

                evt.stopImmediatePropagation();
            }
        },
        // close pay layer with "VK Repost" button
        {
            selector: ".pay .pay-vkrepost",
            evtType: "click",
            callback: function (evt) {
                var headerOverlayActions = Settings.get("headerOverlayActions");
                headerOverlayActions.vkrepost = headerOverlayActions.vkrepost || 0; // vk repost appeared when ya.money completely failed
                headerOverlayActions.vkrepost += 1;
                Settings.set("headerOverlayActions", headerOverlayActions);

                window.open(Config.constants.vk_repost_url);

                Settings.set("headerRateCounter", 0);
                this.closestParent("div.pay").remove();

                evt.stopImmediatePropagation();
            }
        },
        // get LFM token
        {
            selector: ".settings .get-lastfm-token",
            evtType: "click",
            callback: function (evt) {
                var btn = this.attr("disabled", "disabled");
                var initialText = this.html();
                var baseURL = "https://" + chrome.runtime.id + ".chromiumapp.org/cb";

                this.html(chrome.i18n.getMessage("wait") + "...");

                chrome.identity.launchWebAuthFlow({
                    url: "http://www.last.fm/api/auth/?api_key=" + Config.constants.lastfm_api_key,
                    interactive: true
                }, function (responseURL) {
                    btn.html(initialText);

                    if (!responseURL) {
                        btn.removeAttr("disabled");
                        return;
                    }

                    var response = parseQuery(responseURL.replace(baseURL + "?", ""));
                    if (!response.token) {
                        btn.removeAttr("disabled");
                        return;
                    }

                    Lastfm.getSession(response.token, function (sessionData) {
                        btn.removeAttr("disabled");

                        if (!sessionData) {
                            return;
                        }

                        // we got sessionData.name here :)
                        Settings.set("lastfmToken", sessionData.key);

                        Navigation.dispatch("settings");
                    });
                });
            }
        },
        // drop LFM token
        {
            selector: ".settings .drop-lastfm-token",
            evtType: "click",
            callback: function (evt) {
                Settings.set("lastfmToken", "");
                Navigation.dispatch("settings");
            }
        },
        // drop VK token
        {
            selector: ".settings .drop-vk-auth",
            evtType: "click",
            callback: function (evt) {
                Settings.set("vkToken", "");
                Settings.set("lastfmToken", "");

                Sounds.pause();
                Sounds.updatePlaylist();

                Navigation.dispatch("guest");
            }
        },
        // save sendStat option value
        {
            selector: "input[name='sendStatChkbx'][type='radio']",
            evtType: "click",
            callback: function (evt) {
                var optionValue = this.value === "1" ? true : false;
                CPA.changePermittedState(optionValue);

                var savedElem = $(this.closestParent("div.radio"), ".saved").removeClass("hidden");

                // browsers optimize classList manipulations, so .removeClass(display=none).addClass(transition) doesn't work
                // make transition on the next tick to prevent this
                window.setTimeout(function () {
                    savedElem.addClass("saved-hiding")
                }, 0);
            }
        },
        // save showNotifications setting
        {
            selector: "input[name='showNotifications'][type='radio']",
            evtType: "click",
            callback: function (evt) {
                var optionValue = this.value === "1" ? true : false;
                Settings.set("showNotifications", optionValue);

                var savedElem = $(this.closestParent("div.radio"), ".saved").removeClass("hidden");

                // browsers optimize classList manipulations, so .removeClass(display=none).addClass(transition) doesn't work
                // make transition on the next tick to prevent this
                window.setTimeout(function () {
                    savedElem.addClass("saved-hiding")
                }, 0);
            }
        },
        // see album description
        {
            selector: ".more-album-description",
            evtType: "click",
            callback: function (evt) {
                $(".album-summary").addClass("hidden");
                $(".album-description").removeClass("hidden");
            }
        },
        // see next/prev cloud study page
        {
            selector: ".cloud-study button",
            evtType: "click",
            callback: function (evt) {
                var currentView = $(".cloud-study:not(.hide)").data("step");
                var nextView = this.data("view");

                if (!nextView) {
                    CPA.increaseCustomStat("cloud-study-finished");
                    Navigation.dispatch("current");

                    return;
                }

                var btn = this;
                var initialText = this.html();
                var timeoutMs = (nextView > currentView) ? 200 : 0;

                this.disabled = "disabled";
                this.html(chrome.i18n.getMessage("wait") + "...");

                setTimeout(function () {
                    $$(".cloud-study").each(function () {
                        if (this.data("step") === nextView) {
                            this.removeClass("hide");
                        } else {
                            this.addClass("hide");
                        }
                    });

                    btn.html(initialText).removeAttr("disabled");
                }, timeoutMs);

                CPA.increaseCustomStat("cloud-study", nextView);
            }
        },
        // show thumbs up con when user clicks on any icon during cloud studying
        {
            selector: ".cloud-study .glyphicon",
            evtType: "click",
            callback: function (evt) {
                var icon = this;
                var thumbsUpClass = "glyphicon-thumbs-up";
                var origGlyphIcon;

                this.className.split(" ").forEach(function (className) {
                    if (className.indexOf("glyphicon-") === 0 && className !== thumbsUpClass) {
                        origGlyphIcon = className;
                    }
                });

                if (!origGlyphIcon)
                    return;

                this.removeClass(origGlyphIcon).addClass(thumbsUpClass);
                CPA.increaseCustomStat("ee-cloud-study");

                setTimeout(function () {
                    icon.removeClass(thumbsUpClass).addClass(origGlyphIcon);
                }, 500);
            }
        },
        // select vk album
        {
            selector: ".select-album",
            evtType: "change",
            callback: function (evt) {
                VK.getCurrent(0, this.val(), function (data) {
                    var more = (data.count > data.songs.length);

                    Templates.render("songs", {
                        songs: data.songs,
                        more: more,
                        showDownload: Settings.get("showDownloadButtons"),
                        type: "current",
                        progress: true,
                        showRemove: true,
                        removeTitle: chrome.i18n.getMessage("removeTitle"),
                        restoreTitle: chrome.i18n.getMessage("restoreTitle")
                    }, function (html) {
                        $(".music").html(html);
                    });
                });
            }
        },
        // play music file
        {
            selector: ".music .play",
            evtType: "click",
            callback: function (evt) {
                Sounds.updatePlaylist();

                var songContainer = this.closestParent("p.song");
                Sounds.play(songContainer.data("url"));

                evt.stopImmediatePropagation();
                CPA.increaseCustomStat("push-list-play");
            }
        },
        // pause music file
        {
            selector: ".music .pause",
            evtType: "click",
            callback: function (evt) {
                Sounds.pause();
                evt.stopImmediatePropagation();

                CPA.increaseCustomStat("push-list-pause");
            }
        },
        // save MP3 file into Google Drive cloud
        {
            selector: ".music .cloud",
            evtType: "click",
            callback: function (evt) {
                evt.stopImmediatePropagation();

                if (this.hasClass("pending"))
                    return;

                // @todo обрабатывать более умно
                if (!navigator.onLine)
                    return;

                var songElem = this.closestParent("p.song");
                var songURL = songElem.data("url");
                var audioId = songElem.data("vkid");

                SyncFS.queueFile(this.data("artist"), this.data("title"), songURL, audioId);
                this.addClass("pending");

                CPA.sendEvent("Lyfecycle", "Dayuse.New", "Cloud downloads", 1);
                CPA.increaseCustomStat("push-list-cloud");
            }
        },
        // remove file from Google Drive cloud & current list
        {
            selector: ".music .remove",
            evtType: "click",
            callback: function (evt) {
                evt.stopImmediatePropagation();
                var songElem = this.closestParent("p.song");

                var self = this.addClass("act-inactive");
                var ownerId = songElem.data("owner");
                var id = songElem.data("vkid");

                if (ownerId) {
                    VK.removeTrack(ownerId, id, function (res) {
                        self.removeClass("act-inactive").addClass("hidden");
                        $(songElem, ".restore").removeClass("hidden");
                        songElem.addClass("song-about2delete");
                    });

                    CPA.increaseCustomStat("push-list-removecurrent");
                } else {
                    SyncFS.remove(id, function () {
                        songElem.remove();
                        Sounds.updatePlaylist();
                    });

                    CPA.increaseCustomStat("push-list-removecloud");
                }
            }
        },
        // restore track
        {
            selector: ".music .restore",
            evtType: "click",
            callback: function (evt) {
                evt.stopImmediatePropagation();
                var songElem = this.closestParent("p.song");

                var self = this.addClass("act-inactive");
                var ownerId = songElem.data("owner");
                var id = songElem.data("vkid");

                VK.restoreTrack(ownerId, id, function (res) {
                    self.removeClass("act-inactive").addClass("hidden");
                    $(songElem, ".remove").removeClass("hidden");
                    songElem.removeClass("song-about2delete");
                });

                CPA.increaseCustomStat("push-list-restore");
            }
        },
        // add music file to own audio
        {
            selector: ".music .add",
            evtType: "click",
            callback: function (evt) {
                evt.stopImmediatePropagation();

                var self = this.addClass("act-inactive");
                var songElem = this.closestParent("p.song");

                VK.add(songElem.data("owner"), songElem.data("vkid"), function (audioId) {
                    var newClassName = audioId ? "glyphicon-ok" : "glyphicon-remove";
                    self.removeClass("glyphicon-plus").addClass(newClassName);
                });

                CPA.increaseCustomStat("push-list-add");
            }
        },
        // download MP3 file to local computer
        {
            selector: ".music a[download]",
            evtType: "click",
            callback: function (evt) {
                evt.stopImmediatePropagation();
                CPA.sendEvent("Lyfecycle", "Dayuse.New", "Local downloads", 1);

                CPA.increaseCustomStat("push-list-download");
            }
        },
        // load more songs on window croll
        {
            selector: ".music .more",
            evtType: "click",
            callback: function (evt) {
                if (this.hasClass("loading"))
                    return;

                var totalSongsListed = $$(".music p.song").length;
                var self = this.addClass("loading");
                var searchType = this.data("type");
                var queryString = this.data("query");

                var onDataReady = function (data) {
                    Templates.render("songs", {
                        songs: data.songs,
                        progress: false
                    }, function (music) {
                        var newTotalSongsListed = totalSongsListed + data.songs.length;
                        self.removeClass("loading").before(music);

                        if (newTotalSongsListed >= data.count) {
                            self.remove();
                        }
                    });
                };

                switch (searchType) {
                    case "current":
                        var albumSelectNode = $(".select-album");
                        var albumId = albumSelectNode ? albumSelectNode.val() : null;

                        VK.getCurrent(totalSongsListed, albumId, onDataReady);
                        break;

                    case "artist":
                        VK.searchMusicByArtist(queryString, {offset: totalSongsListed}, onDataReady);
                        break;

                    case "global":
                        VK.searchMusic(queryString, {offset: totalSongsListed}, onDataReady);
                        break;
                }
            }
        },
        // search for artists
        {
            selector: "a[href^='artist:'], a[href^='album:']",
            evtType: "click",
            callback: function (evt) {
                evt.preventDefault();
                evt.stopImmediatePropagation();

                var headerElem = $("header input[type='search']").removeData();
                var headerBtn = $("header .search");

                var mbid = this.data("mbid");
                var ymid = this.data("ymid");
                var artist = this.data("artist");
                var album = this.data("album");

                if (mbid.length) {
                    headerElem.data("mbid", mbid);
                } else if (ymid.length) {
                    headerElem.data("ymid", ymid);
                } else if (artist.length && album.length) {
                    headerElem.data({artist: artist, album: album});
                }

                var searchValue = /^artist:/.test(this.attr("href")) ? this.attr("href") : artist + " - " + album;
                headerElem.val(searchValue);

                headerBtn.click();
            }
        },
        // update currently playing song currentTime
        {
            selector: ".music p.song",
            evtType: "click",
            callback: function (evt) {
                var matchesSelectorFn = (Element.prototype.matchesSelector || Element.prototype.webkitMatchesSelector);

                if (this.previousSibling && matchesSelectorFn.call(this.previousSibling, ".song-playing-bg")) {
                    Sounds.updateCurrentTime(evt.layerX / this.clientWidth);
                }

                CPA.increaseCustomStat("push-list-songtime");
            }
        },
        // start playing songs from header
        {
            selector: "footer .play",
            evtType: "click",
            callback: function (evt) {
                Sounds.play();
                CPA.increaseCustomStat("push-footer-play");
            }
        },
        // pause playing songs
        {
            selector: "footer .pause",
            evtType: "click",
            callback: function (evt) {
                Sounds.pause();
                CPA.increaseCustomStat("push-footer-pause");
            }
        },
        // play previous song
        {
            selector: "footer .prev",
            evtType: "click",
            callback: function (evt) {
                Sounds.playPrev();
                CPA.increaseCustomStat("push-footer-prev");
            }
        },
        // play next song
        {
            selector: "footer .next",
            evtType: "click",
            callback: function (evt) {
                Sounds.playNext();
                CPA.increaseCustomStat("push-footer-next");
            }
        },
        // enable/disable shuffle/repeat playing modes
        {
            selector: "footer .mode",
            evtType: "click",
            callback: function (evt) {
                if (this.hasClass("active")) {
                    Sounds.disableMode();
                } else {
                    Sounds.enableMode(this.data("mode"));
                }

                CPA.increaseCustomStat("push-footer-changemode");
            }
        },
        {
            selector: "header input[type='search']",
            evtType: "keyup",
            callback: function (evt) {
                this.removeData();
            }
        },
        {
            selector: "header input[type='search']",
            evtType: "search",
            callback: function (evt) {
                if (!this.val().length) {
                    Navigation.dispatch("current");
                }
            }
        },
        // change volume level
        {
            selector: "footer input[type='range']",
            evtType: "change",
            callback: function (evt) {
                Sounds.changeVolumeLevel(this.value);

                if (changeVolumeTimeoutId) {
                    window.clearTimeout(changeVolumeTimeoutId);
                }

                changeVolumeTimeoutId = window.setTimeout(CPA.increaseCustomStat.bind(CPA), 1000, "push-footer-soundlevel");
            }
        },
        // rewind song with click
        {
            selector: ".rewind-container",
            evtType: "click",
            callback: function (evt) {
                Sounds.updateCurrentTime(evt.layerX / this.clientWidth);
                CPA.increaseCustomStat("rewind-click");
            }
        },
        // finish DND operations
        {
            selector: ".dnd-ready-container .dnd-finish",
            evtType: "click",
            callback: function (evt) {
                DND.finish();
                Navigation.dispatch("current");
            }
        }
    ];

    var mutationObserver = new MutationObserver(function (mutationRecords, observer) {
        mutationRecords.forEach(function (mutationRecord) {
            [].forEach.call(mutationRecord.addedNodes, function (node) {
                if (node.nodeType !== Node.ELEMENT_NODE)
                    return;

                // we can't check an empty node for querySelector/matchesSelector
                var moveParent = false;

                if (!node.hasChildNodes()) {
                    moveParent = true;
                } else {
                    moveParent = [].every.call(node.childNodes, function (childNode) {
                        return (childNode.nodeType !== Node.ELEMENT_NODE);
                    });
                }

                if (moveParent) {
                    node = node.parentNode;
                }

                evtHandlers.forEach(function (handlerData) {
                    $$(node, handlerData.selector).bind(handlerData.evtType, handlerData.callback);
                });
            });

            [].forEach.call(mutationRecord.removedNodes, function (node) {
                if (node.nodeType !== Node.ELEMENT_NODE)
                    return;

                // we can't check an empty node for querySelector/matchesSelector
                if (!node.hasChildNodes()) {
                    node = node.parentNode;
                }

                if (!node)
                    return;

                evtHandlers.forEach(function (handlerData) {
                    $$(node, handlerData.selector).unbind(handlerData.evtType, handlerData.callback);
                });
            });
        });
    });

    mutationObserver.observe(document.body, {
        subtree: true,
        childList: true
    });

    window.addEventListener("online", function (evt) {
        var headerSearchInput = $("header input[type='search']");

        if (headerSearchInput) {
            headerSearchInput.removeAttr("disabled");
        }
    }, false);

    window.addEventListener("offline", function () {
        var headerSearchInput = $("header input[type='search']");

        if (headerSearchInput) {
            headerSearchInput.attr("disabled", "disabled");
            Navigation.dispatch("cloud");
        }
    }, false);

    window.addEventListener("scroll", function () {
        var pageHeight = Math.max(document.body.offsetHeight, document.body.clientHeight);
        var scrollTop = window.innerHeight + window.scrollY;
        var more = $(".music div.more");

        if (scrollTop + 160 >= pageHeight && more) {
            more.click();
        }
    }, false);

    // @see https://code.google.com/p/chromium/issues/detail?id=90793
    document.addEventListener("webkitvisibilitychange", function () {
        Navigation.appWindowVisible = !document.webkitHidden;
    }, false);

    // hotkeys
    document.addEventListener("keydown", function (evt) {
        if (evt.target !== document.body || document.body.hasClass("guest")) {
            return;
        }

        var playerIsPaused = $("footer .pause").hasClass("hidden");
        var keyPressed = true;

        switch (evt.keyCode) {
            case 32:  // space
            case 179: // multimedia.play-pause
                if (playerIsPaused) {
                    Sounds.play();
                } else {
                    Sounds.pause();
                }

                CPA.increaseCustomStat("push-hotkey-playpause");
                break;

            case 13: // return
                if (!playerIsPaused) {
                    Sounds.updateCurrentTime(0);
                    CPA.increaseCustomStat("push-hotkey-return0");
                }

                break;

            case 37:  // left
            case 177: // multimedia.back
                Sounds.playPrev();
                CPA.increaseCustomStat("push-hotkey-prev");
                break;

            case 39:  // right
            case 176: // multimedia.forward
                Sounds.playNext();
                CPA.increaseCustomStat("push-hotkey-next");
                break;

            case 178: // multimedia.stop
                break;

            default:
                keyPressed = false;
        }

        if (keyPressed) {
            evt.preventDefault();
        }
    }, false);

    document.body.bind("submit", function (evt) {
        evt.preventDefault();

        if (evt.target.hasClass("captcha-form")) {
            var codeInserted = $(evt.target, ".captcha-code").val();
            var captchaSrc = $(".img-captcha").data("src");

            Captcha.checkCode(captchaSrc, codeInserted);
            return;
        }

        var lastButton = $(this, "button[type='button']:last-of-type");
        if (!lastButton)
            throw new Error("No button found for making fake submit");

        lastButton.click();
    });

    // DND
    document.body.bind("dragenter", function (evt) {
        evt.stopPropagation();
        evt.preventDefault();
    }).bind("dragover", function (evt) {
        if (Captcha.isActive)
            return;

        evt.stopPropagation();
        evt.preventDefault();

        if (Captcha.isActive)
            return;

        document.documentElement.addClass("overlay-required");
        document.body.addClass("overlay-required");

        $(".dnd-overlay").removeClass("hidden");
        $(".dnd-container").addClass("dnd-container-dragover");
    }).bind("dragleave", function (evt) {
        if (Captcha.isActive)
            return;

        var matchesSelectorFn = (Element.prototype.matchesSelector || Element.prototype.webkitMatchesSelector);
        if (!matchesSelectorFn.call(evt.target, ".dnd-container"))
            return;

        evt.stopPropagation();
        evt.preventDefault();

        DND.finish();
    }).bind("drop", function (evt) {
        if (Captcha.isActive)
            return;

        evt.stopPropagation();
        evt.preventDefault();

        $(".dnd-container").removeClass("dnd-container-dragover");

        var dndReadyContainer = $(".dnd-ready-container");
        if (dndReadyContainer) {
            dndReadyContainer.remove();
        }

        [].forEach.call(evt.dataTransfer.items, function dataTransferIterator(item) {
            // DataTransferItem
            if (!item.isFile && !item.isDirectory) {
                item = item.webkitGetAsEntry();
            }

            // webkitGetAsEntry() may return null when dragging files on windows
            // for DataTransferItem with "text/uri-list" type
            if (!item)
                return;

            if (item.isDirectory) {
                item.createReader().readEntries(function (items) {
                    [].forEach.call(items, dataTransferIterator);
                });
            } else {
                if (item.name.charAt(0) === ".")
                    return;

                item.file(function (file) {
                    if (!/^audio\//.test(file.type))
                        return;

                    DND.upload(file);
                });
            }
        });

        window.setTimeout(function () {
            // @todo this is discusting
            // but still this is more readable than making async recursive reading of directories
            var uploadingFiles = $$(".dnd-file");
            if (!uploadingFiles.length) {
                DND.finish();
            }
        }, 3000);
    });

    if (supportsMP3()) {
        if (Settings.get("vkToken").length) {
            Navigation.dispatch("user");
        } else {
            Navigation.dispatch("guest");
        }
    } else {
        Navigation.dispatch("chromium");
    }

    // run needed tests
    // var neededTests = Settings.get("tests");
    // if (neededTests.length) {
    //     neededTests.forEach(function (testName) {
    //         Tests[testName]();
    //     });

    //     Settings.set("tests", []);
    // }

    Settings.set("appUsedToday", true);
});
