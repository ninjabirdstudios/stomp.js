/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements support for the STOMP protocol (versions 1.0 and 1.1)
/// for the browser using Web Sockets. Frame bodies may be binary or text and
/// support is included for both variable-length and fixed-length frames. Frame
/// bodies are stored as ArrayBuffer instances.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var STOMP = (function (exports)
{
    /// Constants representing the STOMP 1.1 command strings.
    var Commands       = {
        STOMP          : 'STOMP',
        CONNECT        : 'CONNECT',
        CONNECTED      : 'CONNECTED',
        SEND           : 'SEND',
        SUBSCRIBE      : 'SUBSCRIBE',
        UNSUBSCRIBE    : 'UNSUBSCRIBE',
        ACK            : 'ACK',
        NACK           : 'NACK',
        BEGIN          : 'BEGIN',
        COMMIT         : 'COMMIT',
        ABORT          : 'ABORT',
        DISCONNECT     : 'DISCONNECT',
        MESSAGE        : 'MESSAGE',
        RECEIPT        : 'RECEIPT',
        ERROR          : 'ERROR'
    };

    /// Constants representing the STOMP 1.1 header fields.
    var Headers        = {
        ACCEPT_VERSION : 'accept-version',
        HOST           : 'host',
        LOGIN          : 'login',
        PASSCODE       : 'passcode',
        VERSION        : 'version',
        SESSION        : 'session',
        SERVER         : 'server',
        SELECTOR       : 'selector',
        DESTINATION    : 'destination',
        CONTENT_TYPE   : 'content-type',
        CONTENT_LENGTH : 'content-length',
        ID             : 'id',
        ACK            : 'ack',
        HEARTBEAT      : 'heart-beat',
        MESSAGE        : 'message',
        MESSAGE_ID     : 'message-id',
        SUBSCRIPTION   : 'subscription',
        TRANSACTION    : 'transaction',
        RECEIPT        : 'receipt',
        RECEIPT_ID     : 'receipt-id'
    };

    /// Constants indicating the parser states returned by the parser.
    var ParseStates    = {
        NEED_MORE      : 0,
        MESSAGE_READY  : 1
    };

    /// Constants indicating the parser state within the current frame.
    var FrameStates    = {
        SYNCING        : 0,
        HEADERS        : 1,
        BODY           : 2
    };

    /// Constants indicating the parser state within the header block.
    var HeaderStates   = {
        COMMAND        : 0,
        KEY_START      : 1,
        KEY_DATA       : 2,
        VALUE_START    : 3,
        VALUE_DATA     : 4
    };

    /// Constants indicating the state of the ClientConnector.
    var ConnectorStates     = {
        SOCKET_DISCONNECTED : 0,
        CONNECT_SENT        : 1,
        CONNECTOR_READY     : 2,
        DISCONNECT_SENT     : 3
    };

    /// A handy utility function that prevents having to write the same
    /// obnoxious code everytime. The typical javascript '||' trick works for
    /// strings, arrays and objects, but it doesn't work for booleans or
    /// integer values.
    /// @param value The value to test.
    /// @param theDefault The value to return if @a value is undefined.
    /// @return Either @a value or @a theDefault (if @a value is undefined.)
    function defaultValue(value, theDefault)
    {
        return (value !== undefined) ? value : theDefault;
    }

    /// Constructor for the Emitter class, which adds EventEmitter-like
    /// functionality for JavaScript in the browser. The Emitter class is not
    /// generally used directly, instead you Emitter.mixin(yourClass).
    var Emitter = function () {};

    /// Adds the methods of the Emitter type to the prototype of another type.
    /// @param target The constructor function of the target type.
    Emitter.mixin = function (target)
        {
            var props  = ['on','removeListener','removeAllListeners','emit'];
            for (var i = 0, n = props.length; i < n; ++i)
                target.prototype[props[i]] = Emitter.prototype[props[i]];
        };

    /// Registers an event listener for a named event.
    /// @param event A String specifying the name of the event to listen for.
    /// @param callback The callback function to register.
    /// @return A reference to the calling context.
    Emitter.prototype.on = function (event, callback)
        {
            this.eventListeners        = this.eventListeners        || {};
            this.eventListeners[event] = this.eventListeners[event] || [];
            this.eventListeners[event].push(callback);
            return this;
        };

    /// Removes a specific event listener.
    /// @param event A String specifying the name of the event for which the
    /// specified callback is registered.
    /// @param callback The callback function to remove.
    /// @return A reference to the calling context.
    Emitter.prototype.removeListener = function (event, callback)
        {
            this.eventListeners = this.eventListeners || {};
            var listener = this.eventListeners[event];
            if (listener)  listener.splice(listener.indexOf(callback), 1);
            return this;
        };

    /// Removes all listeners for a given event.
    /// @param event A String specifying the name of the event for which all
    /// registered listeners will be removed.
    /// @return A reference to the calling context.
    Emitter.prototype.removeAllListeners = function (event)
        {
            this.eventListeners          = this.eventListeners || {};
            this.eventListeners[event]   = [];
            return this;
        };

    /// Emits a named event, immediately invoking all registered listeners. Any
    /// additional arguments aside from @a event are passed to the listeners.
    /// @param event A String specifying the name of the event being raised.
    /// @return A reference to the calling context.
    Emitter.prototype.emit = function (event)
        {
            this.eventListeners = this.eventListeners || {};
            var listener        = this.eventListeners[event];
            if (listener)
            {
                var count  = arguments.length;
                switch (count)
                {
                    case 1:
                        {
                            for (var i = 0, n = listener.length; i < n; ++i)
                                listener[i].call(this);
                        }
                        break;
                    case 2:
                        {
                            for (var i = 0, n = listener.length; i < n; ++i)
                                listener[i].call(this, arguments[1]);
                        }
                        break;
                    case 3:
                        {
                            for (var i = 0, n = listener.length; i < n; ++i)
                                listener[i].call(this, arguments[1], arguments[2]);
                        }
                        break;
                    default:
                        {
                            var args   = Array.prototype.slice.call(arguments, 1);
                            for (var i = 0, n = listener.length; i < n; ++i)
                                listener[i].apply(this, args);
                        }
                        break;
                }
            }
            return this;
        };

    /// Constructor for the Frame class, which represents a parsed STOMP 1.0
    /// or 1.1 frame. Instances of this type can also be used to construct
    /// your own frames to be sent to the message broker. The constructor
    /// initializes all fields to null or zero; to create an initialized Frame
    /// instance, use Frame.createNew().
    /// @return A reference to the new Frame instance.
    var Frame = function ()
        {
            if (!(this instanceof Frame))
            {
                return new Frame();
            }
            this.command      = null;
            this.headerCount  = 0;
            this.headerFields = null;
            this.headerValues = null;
            this.bodyData     = null;
            return this;
        };

    /// Constructs an initialized instance of the Frame class, which represents
    /// a parsed STOMP 1.0 or 1.1 frame. Instances of this type can also be
    /// used to construct your own frames to be sent to the message broker.
    /// @param command The command string for the frame.
    /// @param headerCount The number of header fields to pre-allocate. Default
    /// value is zero.
    /// @param bodySize The number of bytes of body data to pre-allocate. The
    /// body data is allocated as an ArratBuffer instance. The default is zero,
    /// in which case the bodyData field of the returned Frame is null.
    /// @return A reference to the new Frame instance.
    Frame.createNew = function (command, headerCount, bodySize)
        {
            var frame          = new Frame();
            command            = defaultValue(command,    '');
            headerCount        = defaultValue(headerCount, 0);
            bodySize           = defaultValue(bodySize,    0);
            frame.command      = command;
            frame.headerCount  = 0;
            frame.headerFields = new Array(headerCount);
            frame.headerValues = new Array(headerCount);
            frame.bodyData     =(bodySize > 0 ? new ArrayBuffer(bodySize) : null);
            return frame;
        };

    /// Stores an Object instance, encoded as JSON, into a new ArrayBuffer
    /// instance using UTF-16LE character encoding.
    /// @param obj The object reference to transform into JSON and encode into
    /// the returned Buffer instance.
    /// @return A new ArrayBuffer instance containing the specified object
    /// encoded as a UTF-16LE JSON string.
    Frame.objectToBuffer = function (obj)
        {
            var str = JSON.stringify(obj);
            return Frame.stringToBuffer(str);
        };

    /// Stores String data into a new ArrayBuffer instance as UTF-16LE.
    /// @param str The string to encode into the returned ArrayBuffer instance.
    /// @return A new ArrayBuffer instance containing the specified string.
    Frame.stringToBuffer = function (str)
        {
                str    = str  || '';
            var len    = str.length;
            var buf    = new ArrayBuffer(len * 2); // 2 bytes/codepoint
            var view   = new Uint16Array(buf);
            for (var i = 0; i < len; ++i)
            {
                view[i]= str.charCodeAt(i);
            }
            return buf;
        };

    /// Extracts String data encoded as UTF-16LE in an ArrayBuffer instance.
    /// @param buffer The ArrayBuffer containing the UTF16-LE codepoint data.
    /// @param offset The byte offset into @a buffer. Defaults to zero.
    /// @param count The number of bytes to read from @a buffer. Defaults to
    /// @a buffer.byteLength.
    Frame.bufferToString = function (buffer, offset, count)
        {
            offset  = offset || 0;
            count   = count  || buffer.byteLength;
            var v   = new Uint16Array(buffer, offset, count);
            return String.fromCharCode.apply(null, v);
        };

    /// Creates a copy of an ArrayBuffer instance, or a subregion thereof.
    /// @param buffer The source buffer containing the raw binary data.
    /// @param offset The byte offset into @a buffer at which to begin reading
    /// data. Defaults to 0.
    /// @param sizeInBytes The number of bytes to copy from @a buffer. Defaults
    /// to buffer.byteLength - offset.
    /// @return A new ArrayBuffer instance containing a copy of the subregion.
    Frame.copyBuffer = function (buffer, offset, sizeInBytes)
        {
            if (buffer)
            {
                // create a new Buffer and copy the specified region into it.
                offset      = defaultValue(offset,      0);
                sizeInBytes = defaultValue(sizeInBytes, buffer.byteLength-offset);
                return buffer.slice(offset, offset + sizeInBytes);
            }
            else
            {
                // no source buffer was specified; return an empty ArrayBuffer.
                return new ArrayBuffer(0);
            }
        };

    /// Constructs a properly-formatted value for the content-type header,
    /// based on the specified MIME type and encoding.
    /// @param mimeType The MIME type specifying the format of the body data.
    /// The default is 'text/plain'.
    /// @param encoding The character encoding name. The default is 'utf16-le',
    /// which corresponds to the encoding used for JavaScript String values.
    /// @return A string value suitable for use as the value of a content-type
    /// header field.
    Frame.constructContentType = function (mimeType, encoding)
        {
            mimeType = (mimeType || 'text/plain').toLowerCase();
            encoding = (encoding || 'utf16-le').toLowerCase();
            return mimeType + ';charset=' + encoding;
        };

    /// Computes the size of a string escaped according to the rules of the
    /// STOMP protocol specification.
    /// @param str The string to inspect.
    /// @return The number of characters required to store the string.
    Frame.escapedStringSize = function (str)
        {
            if (str)
            {
                var  length = str.length;
                var  total  = 0;
                for (var i  = 0; i < length; ++i)
                {
                    var ch  = str[i];
                    if (ch != ':' && ch != '\n' && ch != '\\') ++total;
                    else if (ch == ':')  total += 2; // escaped as '\\' and ':'
                    else if (ch == '\n') total += 2; // escaped as '\\' and 'n'
                    else if (ch == '\\') total += 2; // escaped as '\\' and '\\'
                }
                return total;
            }
            return 0;
        };

    /// Computes the total number of bytes required to store a fully-specified
    /// STOMP frame for transmission over the wire. The serialized message will
    /// consume exactly this many bytes.
    /// @return The number of bytes required to store the serialized message.
    Frame.computeWireSize = function (frame)
        {
            var total = 0;
            if (frame)
            {
                var count = frame.headerCount;
                var keys  = frame.headerFields;
                var vals  = frame.headerValues;

                // frame COMMAND (+1 for \n):
                total += frame.command.length + 1;
                // frame HEADERS:
                for (var i = 0; i < count; ++i)
                {
                    total += Frame.escapedStringSize(keys[i]) + 1; // +1 for ':'
                    total += Frame.escapedStringSize(vals[i]) + 1; // +1 for '\n'
                }
                // frame HEADERS TERMINATOR ('\n'):
                total += 1;
                // frame BODY DATA:
                if (frame.bodyData)
                    total += frame.bodyData.byteLength;
                // frame BODY TERMINATOR ('\0'):
                total += 1;
            }
            return total;
        };

    /// Escapes a string and writes the data to the specified buffer.
    /// @param view The destination Uint8Array object.
    /// @param offset The current byte offset into the buffer.
    /// @param str The string to escape and write. The string should contain
    /// only ASCII codepoints.
    /// @return The number of bytes written to the buffer.
    Frame.escapeStringToBuffer = function (view, offset, str)
        {
            // @note: technically, header data should be sent as UTF-8, and
            // node.js can support this efficiently, but our implementation
            // is restricted to ASCII for the widest compatibility/performance.
            if (str)
            {
                var  SL     = 92;  // ASCII code for '\\'
                var  AC     = 99;  // ASCII code for 'c'
                var  AN     = 110; // ASCII code for 'n'
                var  length = str.length;
                var  count  = 0;
                for (var i  = 0; i < length; ++i)
                {
                    var nw  = 0;
                    var ch  = str[i];
                    var cv  = str.charCodeAt(i);
                    if (ch != ':' && ch != '\n' && ch != '\\')
                    {
                        view[offset]     = cv;
                        nw  = 1;
                    }
                    else if (ch == ':')
                    {
                        view[offset]     = SL;
                        view[offset+1]   = AC;
                        nw  = 2;
                    }
                    else if (ch == '\n')
                    {
                        view[offset]     = SL;
                        view[offset+1]   = AN;
                        nw  = 2;
                    }
                    else if (ch == '\\')
                    {
                        view[offset]     = SL;
                        view[offset+1]   = SL;
                        nw  = 2;
                    }
                    offset += nw;
                    count  += nw;
                }
                return count;
            }
            return 0;
        };

    /// Serializes the entire STOMP frame to an existing node.js Buffer.
    /// @param frame The complete STOMP frame to serialize.
    /// @param buffer The node.js Buffer instance to which the serialized
    /// message data will be written. This buffer must be large enough to
    /// hold the entire message.
    /// @return The number of bytes written to the buffer.
    Frame.writeToBuffer = function (frame, buffer)
        {
            var offset  = 0;
            var view    = new Uint8Array(buffer);
            var command = frame.command;
            var count   = frame.headerCount;
            var keys    = frame.headerFields;
            var vals    = frame.headerValues;
            var body    = frame.bodyData;
            var size    = frame.bodyData != null ? frame.bodyData.byteLength : 0;
            var LF      = 10; // ASCII code for '\n'
            var CL      = 58; // ASCII code for ':'
            var ZB      = 0;  // ASCII code for '\0'

            // write the COMMAND string.
            for (var i  = 0, cln = command.length; i < cln; ++i)
            {
                view[offset++] = command.charCodeAt(i);
            }
            // write the COMMAND TERMINATOR, a newline.
            view[offset++] = LF;

            // write the HEADER data.
            for (var i  = 0; i < count; ++i)
            {
                offset += Frame.escapeStringToBuffer(view, offset, keys[i]);
                view[offset++] = CL; // ':'
                offset += Frame.escapeStringToBuffer(view, offset, vals[i]);
                view[offset++] = LF; // '\n'
            }
            // write the HEADER TERMINATOR, a blank line.
            view[offset++] = LF;

            // write the BODY data.
            if (body && size > 0)
            {
                // copy the body buffer into the target buffer.
                view.set(new Uint8Array(body), offset);
                offset += size;
            }
            // write the BODY TERMINATOR, a null byte.
            view[offset++] = ZB;
            return offset;
        };

    /// Obtain the zero-based index of the last header with the specified name.
    /// @param name The name of the header to search for.
    /// @return The index of the last header entry with the specified name, or
    /// -1 if the frame doesn't contain any headers with that name.
    Frame.prototype.indexOfLast = function (name)
        {
            if (name)
            {
                var  count = this.headerCount;
                var  keys  = this.headerFields;
                var  key   = name.toLowerCase();
                for (var i = count - 1; i >= 0; --i)
                {
                    if (key == keys[i])
                        return i;
                }
            }
            return -1;
        };

    /// Obtain the zero-based index of the next header with the specified name.
    /// @param name The name of the header to search for.
    /// @param start The zero-based starting index. Defaults to zero.
    /// @return The index of the next header entry with the specified name, or
    /// -1 if there are no occurrences of the named header after @a start.
    Frame.prototype.indexOfNext = function (name, start)
        {
            if (name)
            {
                var  count = this.headerCount;
                var  key   = name.toLowerCase();
                for (var i = start || 0; i < this.headerCount; ++i)
                {
                    if (key == keys[i])
                        return i;
                }
            }
            return -1;
        };

    /// Appends a new header record to the frame.
    /// @param name The name of the header.
    /// @param value The value associated with the header.
    /// @return A reference to the Frame.
    Frame.prototype.appendHeader = function (name, value)
        {
            this.headerFields.push(name.toLowerCase());
            this.headerValues.push(value || '');
            this.headerCount++;
            return this;
        };

    /// Overrides the last header with a given name, assigning it a new value.
    /// If the specified header does not exist, it is created.
    /// @param name The name of the header.
    /// @param value The value associated with the header.
    /// @return A reference to the Frame.
    Frame.prototype.overrideHeader = function (name, value)
        {
            var index  = this.indexOfLast(name);
            if (index >= 0)
            {
                // override the existing header value.
                this.headerValues[index] = value || '';
            }
            else
            {
                // append a new header value.
                this.headerFields.push(name.toLowerCase());
                this.headerValues.push(value || '');
                this.headerCount++;
            }
            return this;
        };

    /// Removes the last occurrence (most recently added) of a given header.
    /// @param name The name of the header to remove.
    /// @return The previous value of the header field, or an empty string.
    Frame.prototype.removeLastHeaderOfType = function (name)
        {
            var index  = this.indexOfLast(name);
            if (index >= 0)
            {
                var v  = this.headerValues[index];
                this.headerFields.slice(index, 1);
                this.headerValues.slice(index, 1);
                this.headerCount--;
                return v;
            }
            return '';
        };

    /// Removes all occurrences of a given header.
    /// @param name The name of the header to remove.
    /// @return A reference to the Frame.
    Frame.prototype.removeAllHeadersOfType = function (name)
        {
            var    index = this.indexOfNext(name, 0);
            while (index > 0)
            {
                this.headerFields.slice(index, 1);
                this.headerValues.slice(index, 1);
                this.headerCount--;
                index = this.indexOfNext(name, index + 1);
            }
            return this;
        };

    /// Gets an object representing the header key-value pair for an index.
    /// @param index The zero-based index of the header to retrieve.
    /// @return A new object with name and value fields.
    Frame.prototype.getHeader = function (index)
        {
            if (index >= 0 && index < this.headerCount)
            {
                // return the header data as an object.
                return    {
                    name  : this.headerFields[index],
                    value : this.headerValues[index]
                };
            }
            else
            {
                // return an empty header object.
                return    {
                    name  : '',
                    value : ''
                };
            }
        };

    /// Retrieves the value associated with a named header. The latest value
    /// is returned.
    /// @param name The name of the header to look up.
    /// @return The value associated with the specified header, or an empty
    /// string value.
    Frame.prototype.getHeaderValue = function (name)
        {
            var index  = this.indexOfLast(name);
            if (index >= 0)
            {
                return this.headerValues[index];
            }
            return '';
        };

    /// Inspects the content-type header, if present, to determine the MIME
    /// content type and character encoding that apply to the frame body data.
    /// @param defaultMimeType The MIME type to return if no content-type
    /// header is present.
    /// @param defaultEncoding The default encoding name to return if no
    /// content-type header is present.
    /// @return A new object with fields mimeType and encoding, indicating the MIME
    /// type and encoding name that can be used to interpret the body data.
    Frame.prototype.determineContentType = function (defaultMimeType, defaultEncoding)
        {
            var index  = this.indexOfLast(Headers.CONTENT_TYPE);
            if (index >= 0)
            {
                var te = this.headerValues[index].split(';');
                var ct = defaultMimeType || '';
                var ce = defaultEncoding || '';
                if (te.length > 1)
                {
                    // te[1] is 'charset=blah'. we want the 'blah' part.
                    var encodingParts = te[1].split('=');
                    if (encodingParts.length > 0)
                    {
                        ce = encodingParts[0].trim().toLowerCase();
                    }
                }
                if (te.length > 0)
                {
                    // te[0] is the MIME content type. no further parsing needed.
                    ct = te[0].trim().toLowerCase();
                }
                return {
                    mimeType : ct,
                    encoding : ce
                };
            }
            else
            {
                return {
                    mimeType : defaultMimeType || '',
                    encoding : defaultEncoding || ''
                };
            }
        };

    /// Appends a new content-type header field with the specified MIME type
    /// and character set.
    /// @param mimeType The MIME type specifying the format of the body data.
    /// The default is 'text/plain'.
    /// @param encoding The encoding name. The default is 'utf-16le', which
    /// corresponds to the encoding used for JavaScript String values. Specify
    /// an empty string to omit the charset value.
    /// @return A reference to the Frame.
    Frame.prototype.appendContentType = function (mimeType, encoding)
        {
            var key = Headers.CONTENT_TYPE;
            var val = Frame.constructContentType(mimeType, encoding);
            return this.appendHeader(key, val);
        };

    /// Overrides the last content-type header field with the specified MIME
    /// type and character set, or appends a new content-type header.
    /// @param mimeType The MIME type specifying the format of the body data.
    /// The default is 'text/plain'.
    /// @param encoding The encoding name. The default is 'utf-16le', which
    /// corresponds to the encoding used for JavaScript String values. Specify
    /// an empty string to omit the charset value.
    /// @return A reference to the Frame.
    Frame.prototype.overrideContentType = function (mimeType, encoding)
        {
            var key = Headers.CONTENT_TYPE;
            var val = Frame.constructContentType(mimeType, encoding);
            return this.overrideHeader(key, val);
        };

    /// Appends a new content-length header field with the specified value.
    /// @param body The body data, stored in an ArrayBuffer instance.
    /// @return A reference to the Frame.
    Frame.prototype.appendContentLength = function (body, encoding)
        {
            var key = Headers.CONTENT_LENGTH;
            var val =(body != null ? body.byteLength.toString() : '0');
            return this.appendHeader(key, val);
        };

    /// Overrides the last content-length header field with the specified
    /// value, or appends a new content-length header if none exists.
    /// @param body The body data, stored in an ArrayBuffer instance.
    /// @return A reference to the Frame.
    Frame.prototype.overrideContentLength = function (body, encoding)
        {
            var key = Headers.CONTENT_LENGTH;
            var val =(body != null ? body.byteLength.toString() : '0');
            return this.overrideHeader(key, val);
        };

    /// Serializes the entire STOMP frame into a new ArrayBuffer instance.
    /// @return A new Buffer containing the serialized frame data.
    Frame.prototype.toBuffer = function ()
        {
            var length = Frame.computeWireSize(this);
            var buffer = new ArrayBuffer(length);
            Frame.writeToBuffer(this, buffer);
            return buffer;
        };

    /// Constructs and initializes a new Parser instance, preparing it to start
    /// parsing a new message.
    /// @return A reference to the newly constructed Parser.
    var Parser = function ()
        {
            if (!(this instanceof Parser))
            {
                return new Parser();
            }
            var buffer        = new ArrayBuffer(8192);
            this.state        = ParseStates.NEED_MORE;
            this.frameState   = FrameStates.SYNCING;
            this.headerState  = HeaderStates.COMMAND;
            this.command      = [];
            this.currentKey   = [];
            this.currentValue = [];
            this.headerFields = [];
            this.headerValues = [];
            this.headerCount  = 0;
            this.bodySize     = 0;
            this.bodyOffset   = 0;
            this.bodyBuffer   = new Uint8Array(buffer);
            this.fixedLength  = false;
            return this;
        };

    /// Resets the current state of the parser, preparing it to start parsing
    /// a new message.
    /// @return A reference to the Parser.
    Parser.prototype.reset = function ()
        {
            var buffer        = new ArrayBuffer(8192);
            this.state        = ParseStates.NEED_MORE;
            this.frameState   = FrameStates.SYNCING;
            this.headerState  = HeaderStates.COMMAND;
            this.command      = [];
            this.currentKey   = [];
            this.currentValue = [];
            this.headerFields = [];
            this.headerValues = [];
            this.headerCount  = 0;
            this.bodySize     = 0;
            this.bodyOffset   = 0;
            this.bodyBuffer   = new Uint8Array(buffer);
            this.fixedLength  = false;
            return this;
        };

    /// Pushes a single input byte into the parser.
    /// @param byte The input byte.
    /// @return The current parser state, one of the ParseStates values.
    Parser.prototype.push = function (byte)
        {
            if (ParseStates.NEED_MORE == this.state)
            {
                switch (this.frameState)
                {
                    case FrameStates.SYNCING:
                        this.state = this.stateSyncing(byte);
                        break;
                    case FrameStates.HEADERS:
                        this.state = this.stateHeaders(byte);
                        break;
                    case FrameStates.BODY:
                        this.state = this.stateBody(byte);
                        break;
                }
            }
            return this.state;
        };

    /// Retrieves the current STOMP frame. This function should be called when
    /// the Parser.push() method returns ParseStates.MESSAGE_READY. After
    /// retrieving the current STOMP frame, call Parser.reset().
    /// @return A new Frame instance representing the received message or null.
    Parser.prototype.returnMessage = function ()
        {
            if (ParseStates.MESSAGE_READY == this.state)
            {
                var frame          = new Frame();
                var dataSize       = this.bodyOffset;
                frame.command      = this.command.join('').trim().toUpperCase();
                frame.headerCount  = this.headerCount;
                frame.headerFields = this.headerFields;
                frame.headerValues = this.headerValues;
                frame.bodyData     = this.bodyBuffer.buffer.slice(0, dataSize);
                return frame;
            }
            return null;
        };

    /// Unescapses a string encoded as a character array, and returns the
    /// result as a string.
    /// @param charArray The character array to unescape.
    /// @return The unescaped string.
    Parser.prototype.unescape = function (charArray)
        {
            var maxch   = charArray.length;
            var result  = new Array(maxch);
            var count   = 0;
            for (var i  = 0; i < maxch; ++i)
            {
                var ch  = charArray[i];
                var cn  = 0;
                if (ch != '\\')
                {
                    // not an escape sequence.
                    result[count++] = ch;
                }
                else if ((i + 1) < maxch)
                {
                    cn  = charArray[i+1];
                    // we've hit an escape character.
                    if ('c' == cn)
                    {
                        result[count++] = ':';
                        ++i;
                    }
                    else if ('n' == cn)
                    {
                        result[count++] = '\n';
                        ++i;
                    }
                    else if ('\\' == cn)
                    {
                        result[count++] = '\\';
                        ++i;
                    }
                    // else, an invalid escape sequence.
                }
            }
            result.length  = count;
            return result.join('');
        };

    /// Inspects the current set of headers to determine the if the
    /// content-length header has been specified and updates the internal
    /// state appropriately.
    Parser.prototype.determineContentLength = function ()
        {
            var  clhdr =  Headers.CONTENT_LENGTH;
            var  count =  this.headerCount;
            var  hkeys =  this.headerFields;
            for (var i =  count - 1; i >= 0; --i)
            {
                if (clhdr == hkeys[i])
                {
                    var value  = parseInt(this.headerValues[i]);
                    this.bodySize       = value >= 0 ? value : 0;
                    this.bodyOffset     = 0;
                    this.fixedLength    = value >= 0 ? true  : false;
                    if (this.bodySize   > this.bodyBuffer.byteLength)
                        this.bodyBuffer = new ArrayBuffer(this.bodySize);
                    return;
                }
            }
            this.bodySize    = 0;
            this.bodyOffset  = 0;
            this.fixedLength = false;
        };

    /// Implements the processing for the state where the parser is looking
    /// for the start of a frame.
    /// @param byte The input byte.
    /// @return One of the ParseStates values.
    Parser.prototype.stateSyncing = function (byte)
        {
            // if this is a character 'A'-'Z' or 'a'-'z'...
            if ((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))
            {
                this.command.push(String.fromCharCode(byte));
                this.frameState  = FrameStates.HEADERS;
                this.headerState = HeaderStates.COMMAND;
            }
            return ParseStates.NEED_MORE;
        };

    /// Implements the processing for the state where the parser is processing
    /// header data.
    /// @param byte The input byte.
    /// @return one of the ParseStates values.
    Parser.prototype.stateHeaders = function (byte)
        {
            var LF  = 10; // ASCII code for '\n'
            var CL  = 58; // ASCII code for ':'
            var ZB  = 0;  // ASCII code for '\0'
            switch (this.headerState)
            {
                case HeaderStates.COMMAND:
                    {
                        if (byte != LF)
                        {
                            // this byte is part of the command string.
                            this.command.push(String.fromCharCode(byte));
                        }
                        else
                        {
                            // the command is terminated with a newline.
                            this.headerState = HeaderStates.KEY_START;
                        }
                    }
                    break;

                case HeaderStates.KEY_START:
                    {
                        if (byte != LF)
                        {
                            // this is the start of a header field.
                            this.currentKey   = [String.fromCharCode(byte)];
                            this.currentValue = [];
                            this.headerState  = HeaderStates.KEY_DATA;
                        }
                        else
                        {
                            // this is a blank line and the end of headers.
                            this.frameState   = FrameStates.BODY;
                            this.determineContentLength();
                        }
                    }
                    break;

                case HeaderStates.KEY_DATA:
                    {
                        if (byte != CL && byte != LF)
                        {
                            // this is part of the header field.
                            this.currentKey.push(String.fromCharCode(byte));
                        }
                        else if (byte == CL)
                        {
                            // this is the end of the header key; start data.
                            this.headerState = HeaderStates.VALUE_START;
                        }
                        else if (byte == LF)
                        {
                            // this is the end of this particular header field.
                            var key = this.unescape(this.currentKey).trim();
                            var val = '';
                            this.headerFields.push(key.toLowerCase());
                            this.headerValues.push(val);
                            this.headerCount++;
                            this.headerState = HeaderStates.KEY_START;
                        }
                    }
                    break;

                case HeaderStates.VALUE_START:
                case HeaderStates.VALUE_DATA:
                    {
                        if (byte != LF)
                        {
                            // this is part of the header value.
                            this.currentValue.push(String.fromCharCode(byte));
                        }
                        else
                        {
                            // there is no header value for this field.
                            var key = this.unescape(this.currentKey).trim();
                            var val = this.unescape(this.currentValue);
                            this.headerFields.push(key.toLowerCase());
                            this.headerValues.push(val.trimLeft());
                            this.headerCount++;
                            this.headerState = HeaderStates.KEY_START;
                        }
                    }
                    break;
            }
            return ParseStates.NEED_MORE;
        };

    /// Implements the processing for the state where the parser is processing
    /// body data (either fixed-length or variable-length).
    /// @param byte The input byte.
    /// @return one of the ParseStates values.
    Parser.prototype.stateBody = function (byte)
        {
            if (this.fixedLength)
            {
                // fixed-length body; our buffer was pre-allocated.
                if (this.bodyOffset < this.bodySize)
                {
                    this.bodyBuffer[this.bodyOffset++] = byte;
                    return ParseStates.NEED_MORE;
                }
                else if (byte == 0)
                {
                    // this is the end of the frame body.
                    return ParseStates.MESSAGE_READY;
                }
                else
                {
                    // unexpected data; the content-length was incorrect.
                    return ParseStates.NEED_MORE;
                }
            }
            else
            {
                // variable-length body; a single null byte will terminate.
                if (byte != 0)
                {
                    if (this.bodyOffset < this.bodyBuffer.byteLength)
                    {
                        this.bodyBuffer[this.bodyOffset++] = byte;
                        return ParseStates.NEED_MORE;
                    }
                    else
                    {
                        var newlen = this.bodyBuffer.byteLength + 8192;
                        var target = new ArrayBuffer(newlen);
                        var tview  = new Uint8Array(target);
                        tview.set(this.bodyBuffer, 0);
                        this.bodyBuffer = tview;;
                        this.bodyBuffer[this.bodyOffset++] = byte;
                        return ParseStates.NEED_MORE;
                    }
                }
                else
                {
                    // this is the end of the frame body.
                    return ParseStates.MESSAGE_READY;
                }
            }
        };

    /// Constructs and initializes a new ClientConnection instance, which
    var ClientConnection = function ()
        {
            if (!(this instanceof ClientConnection))
            {
                return new ClientConnection();
            }
            this.messageId = 0;
            this.canSend   = false;
            this.parser    = new Parser();
            this.socket    = null;
            return this;
        };
    Emitter.mixin(ClientConnection);

    /// Callback invoked when the socket emits the 'connect' event. The
    /// ClientConnection instance emits its own 'connect' event, passing a
    /// reference to itself as the first parameter.
    ClientConnection.prototype.connectHandler = function ()
        {
            this.canSend   = true;
            this.messageId = 0;
            this.emit('connect', this);
        };

    /// Callback invoked when some data is received on the socket. The
    /// ClientConnection instance parses the data and may emit a 'message'
    /// event, with the first parameter being a reference to the
    /// ClientConnection and the second parameter being a Frame instance.
    /// @param e An Event whose data property specifies the received data.
    ClientConnection.prototype.dataHandler = function (e)
        {
            var data   = e.data;
            var view   = new Uint8Array(data);
            var offset = 0;
            var length = view.byteLength;
            var parser = this.parser;
            for (var i = 0; i < length; ++i)
            {
                var bt = view[i];
                var st = parser.push(bt);
                if (ParseStates.MESSAGE_READY ==  st)
                {
                    var frame = parser.returnMessage();
                    parser.reset();
                    this.emit('message', this, frame);
                }
            }
        };

    /// Callback invoked when an error occurs related to the socket. The
    /// ClientConnection instance emits an 'error' event, with the first
    /// parameter being a reference to the ClientConnection and the second
    /// parameter being an Error instance.
    /// @param error The Error instance containing additional information.
    ClientConnection.prototype.errorHandler = function (error)
        {
            // emit the 'error' event. we'll get a 'close' event also.
            // @todo: is this actually true with WebSocket as well????
            this.canSend = false;
            this.emit('error', this, error);
        };

    /// Callback invoked when the socket connection is fully closed. The
    /// ClientConnection instance emits a 'disconnect' event, with the first
    /// parameter being a reference to the ClientConnection.
    ClientConnection.prototype.closeHandler = function ()
        {
            // emit the 'disconnect' event.
            this.canSend = false;
            this.emit('disconnect', this);
        };

    /// Attempts to establish a connection to the remote message broker. If the
    /// connection attempt is successful, the 'connect' event is emitted. If an
    /// error occurs, the 'error' event is emitted.
    /// @param host The hostname or IP address of the remote host. The default
    /// value is 'localhost'.
    /// @param port The port number on which the remote host is listening for
    /// incoming STOMP connections. The default value is 61613.
    /// @return A reference to the ClientConnection.
    ClientConnection.prototype.connect = function (connectionString)
        {
            connectionString       = connectionString || 'ws://localhost:61613';
            this.canSend           = false;
            this.socket            = new WebSocket(connectionString);
            this.socket.binaryType = 'arraybuffer';
            this.socket.onopen     = this.connectHandler.bind(this);
            this.socket.onmessage  = this.dataHandler.bind(this);
            this.socket.onerror    = this.errorHandler.bind(this);
            this.socket.onclose    = this.closeHandler.bind(this);
            return this;
        };

    /// Attempts to gracefully disconnect from the remote message broker by
    /// closing this end of the socket connection. A 'disconnect' event will be
    /// emitted when the connection has fully shutdown. No more data can be
    /// sent by this end of the socket.
    /// @return A reference to the ClientConnection.
    ClientConnection.prototype.disconnect = function ()
        {
            if (this.socket)
            {
                // we can't send anymore, but we could still receive some data.
                this.canSend = false;
                this.socket.close();
            }
            return this;
        };

    /// Sends a STOMP frame to the message broker. The data may be queued for
    /// sending if the socket is currently busy.
    /// @param frame The STOMP frame to send.
    /// @return The ID of the message, or -1 if the message was not sent.
    ClientConnection.prototype.send = function (frame)
        {
            if (this.canSend && frame)
            {
                var buffer = frame.toBuffer();
                this.socket.send(buffer);
                return this.messageId++;
            }
            return -1;
        };

    /// Constructs and initializes a new ClientConnector instance, which
    /// implements the higher-level state machine that manages a STOMP client
    /// connection.
    /// @return A reference to the newly constructed ClientConnector.
    var ClientConnector  = function ()
        {
            if (!(this instanceof ClientConnector))
            {
                return new ClientConnector();
            }
            this.state        = ConnectorStates.SOCKET_DISCONNECTED;
            this.url          = 'ws://localhost:61613';
            this.host         = 'localhost';
            this.username     = '';
            this.password     = '';
            this.sessionId    = '';
            this.version      = '';
            this.disconnectId = -2;
            this.connection   = new ClientConnection();
            this.connection.on('connect',    this.connectHandler.bind(this));
            this.connection.on('error',      this.errorHandler.bind(this));
            this.connection.on('message',    this.messageHandler.bind(this));
            this.connection.on('disconnect', this.disconnectHandler.bind(this));
            return this;
        };
    Emitter.mixin(ClientConnector);

    /// Handles the connection event indicating that the socket connection has
    /// been established, and sends the CONNECT frame to the broker to initiate
    /// the logical connection process.
    /// @param connection A reference to the ClientConnection.
    ClientConnector.prototype.connectHandler = function (connection)
        {
            var host   = this.host;
            var user   = this.username;
            var pass   = this.password;
            var frame  = this.createConnect(host, user, pass, '1.0,1.1');
            this.state = ConnectorStates.CONNECT_SENT;
            this.connection.send(frame);
        };

    /// Handles the connection event indicating that the socket has been closed
    /// as the result of an error condition.
    /// @param connection A reference to the ClientConnection.
    /// @param error An Error instance providing additional information.
    ClientConnector.prototype.errorHandler = function (connection, error)
        {
            this.state  = ConnectorStates.SOCKET_DISCONNECTED;
            this.emit('error', this, error);
        };

    /// Handles the connection event indicating that a STOMP frame has been
    /// received, and emits a 'message' event.
    /// @param connection A reference to the ClientConnection.
    /// @param frame A reference to the received Frame.
    ClientConnector.prototype.messageHandler = function (connection, frame)
        {
            this.emit('message', this, frame);
            switch (frame.command)
            {
                case Commands.CONNECTED:
                    this.handleCONNECTED(frame);
                    break;
                case Commands.ERROR:
                    this.handleERROR(frame);
                    break;
            }
        };

    /// Handles the connection event indicating that the socket connection has been
    /// closed, and emits a 'disconnect' event.
    /// @param connection A reference to the ClientConnection.
    ClientConnector.prototype.disconnectHandler = function (connection)
        {
            this.state     = ConnectorStates.SOCKET_DISCONNECTED;
            this.emit('disconnect', this);
            this.version   = '';
            this.sessionId = '';
        };

    /// Handles the receipt of a CONNECTED frame, indicating that the broker
    /// has accepted the client credentials. Extracts the version of the
    /// protocol that will be used to communicate with the server, as well as
    /// any server-supplied session ID, and emits first the 'subscribe' event
    /// followed by the 'ready' event indicating that the connector is ready
    /// for active use.
    /// @param frame The STOMP CONNECTED frame.
    ClientConnector.prototype.handleCONNECTED = function (frame)
        {
            if (ConnectorStates.CONNECT_SENT == this.state)
            {
                this.state        = ConnectorStates.CONNECTOR_READY;
                this.version      = frame.getHeaderValue(Headers.VERSION);
                this.sessionId    = frame.getHeaderValue(Headers.SESSION);
                this.disconnectId = -2;
                this.emit('subscribe', this);
                this.emit('ready', this);
            }
        };

    /// Handles the receipt of an ERROR frame. If the ERROR was received in
    /// response to a CONNECT request, a 'rejected' event is emitted.
    /// @param frame The STOMP ERROR frame.
    ClientConnector.prototype.handleERROR = function (frame)
        {
            if (ConnectorStates.CONNECT_SENT == this.state)
            {
                this.emit('rejected',  this);
                this.connection.disconnect();
            }
        };

    /// Establishes a connection to a message broker.
    /// @param connectionString The WebSocket connection string.
    /// @return A reference to the ClientConnector.
    ClientConnector.prototype.connect = function (connectionString)
        {
            if (ConnectorStates.SOCKET_DISCONNECTED == this.state)
            {
                if (connectionString)   this.url = connectionString;
                this.connection.connect(this.url);
            }
            return this;
        };

    /// Begins the process of disconnecting from the message broker.
    /// @param sendDisconnected Specify true to send a DISCONNECT frame and
    /// ensure that all frames sent so far have been received by the broker.
    /// @return A reference to the ClientConnector.
    ClientConnector.prototype.disconnect = function (sendDisconnected)
        {
            if (sendDisconnected)
            {
                // begin the process of disconnecting gracefully.
                this.state        = ConnectorStates.DISCONNECT_SENT;
                var frame         = this.createDisconnect();
                this.disconnectId = this.connection.send(frame);
            }
            // shut down the sending end of our socket. any queued
            // data will be sent before the socket is shut down.
            this.connection.disconnect();
            return this;
        };

    /// Sends a client frame to the message broker.
    /// @param frame The frame to send.
    /// @return The integer message ID of the frame.
    ClientConnector.prototype.send = function (frame)
        {
            return this.connection.send(frame);
        };

    /// Adds a receipt header to a message frame with the current message ID.
    /// @param frame The STOMP frame to decorate.
    /// @return The ID assigned to the message frame.
    ClientConnector.prototype.requestReceipt = function (frame)
        {
            var msgid = this.connection.messageId.toString();
            frame.overrideHeader(Headers.RECEIPT, msgid);
            return this.connection.messageId;
        };

    /// Constructs a basic CONNECT frame. The broker will respond with either a
    /// CONNECTED or an ERROR frame.
    /// @param host The name of the STOMP broker to connect to.
    /// @param username The username used to log in to the message broker, or
    /// null or an empty string to not include login information.
    /// @param password The password used to log in to the message broker.
    /// @param versions A comma-delimited list of STOMP versions the client will
    /// accept; for example, '1.0,1.1'.
    /// @return The message frame.
    ClientConnector.prototype.createConnect = function (host, username, password, versions)
        {
            var frame = Frame.createNew(Commands.CONNECT);
            host      = host     || 'localhost';
            username  = username || '';
            password  = password || '';
            versions  = versions || '1.0,1.1';
            frame.appendHeader(Headers.ACCEPT_VERSION, versions);
            frame.appendHeader(Headers.HOST, host);
            if (username.length > 0)
            {
                frame.appendHeader(Headers.LOGIN,    username);
                frame.appendHeader(Headers.PASSCODE, password);
            }
            return frame;
        };

    /// Constructs a basic DISCONNECT frame. The server will respond with a
    /// RECEIPT frame. The client should not send any additional messages after
    /// sending DISCONNECT.
    /// @return The message frame.
    ClientConnector.prototype.createDisconnect = function ()
        {
            var frame = Frame.createNew(Commands.DISCONNECT);
            var msgid = this.connection.messageId.toString();
            frame.appendHeader(Headers.RECEIPT, msgid);
            return frame;
        };

    /// Constructs a basic SUBSCRIBE frame used to subscribe to a topic
    /// or queue.
    /// @param id A unique identifier for the subscription on the client.
    /// @param topicOrQueue The name of the topic or queue to subscribe to.
    /// @param ackType The ACK method to use. Defaults to 'auto'.
    /// @return The message frame.
    ClientConnector.prototype.createSubscribe = function (id, topicOrQueue, ackType)
        {
            var frame = Frame.createNew(Commands.SUBSCRIBE)
            ackType   = ackType || 'auto';
            frame.appendHeader(Headers.ID, id.toString());
            frame.appendHeader(Headers.DESTINATION, topicOrQueue);
            frame.appendHeader(Headers.ACK, ackType);
            return frame;
        };

    /// Constructs a basic UNSUBSCRIBE frame used to remove a subscription from
    /// a topic or queue.
    /// @param id The unique identifier for the subscription on the client.
    /// This must be the same value specified on the CONNECT frame.
    /// @param topicOrQueue The name of the topic or queue to unsubscribe from.
    /// @return The message frame.
    ClientConnector.prototype.createUnsubscribe = function (id, topicOrQueue)
        {
            var frame = Frame.createNew(Commands.UNSUBSCRIBE);
            frame.appendHeader(Headers.ID, id.toString());
            frame.appendHeader(Headers.DESTINATION, topicOrQueue);
            return frame;
        };

    /// Constructs a basic ACK frame used to acknowledge that the client has
    /// consumed a particular message.
    /// @param message The message being ACK'd.
    /// @return The message frame.
    ClientConnector.prototype.createAck = function (message)
        {
            var frame = Frame.createNew(Commands.ACK);
            var subid = message.getHeaderValue(Headers.SUBSCRIPTION);
            var dstid = message.getHeaderValue(Headers.DESTINATION);
            var msgid = message.getHeaderValue(Headers.MESSAGE_ID);
            frame.appendHeader(Headers.SUBSCRIPTION, subid || dstid);
            frame.appendHeader(Headers.MESSAGE_ID,   msgid);
            return frame;
        };

    /// Constructs a basic NACK frame used to acknowledge that the client has
    /// NOT consumed a particular message.
    /// @param message The message being NACK'd.
    /// @return The message frame.
    ClientConnector.prototype.createNack = function (message)
        {
            var frame = Frame.createNew(Commands.NACK);
            var subid = message.getHeaderValue(Headers.SUBSCRIPTION);
            var dstid = message.getHeaderValue(Headers.DESTINATION);
            var msgid = message.getHeaderValue(Headers.MESSAGE_ID);
            frame.appendHeader(Headers.SUBSCRIPTION, subid || dstid);
            frame.appendHeader(Headers.MESSAGE_ID,   msgid);
            return frame;
        };

    /// Constructs a basic SEND frame used to send a message to a topic
    /// or queue.
    /// @param topicOrQueue The destination topic or queue.
    /// @return The message frame.
    ClientConnector.prototype.createMessage = function (topicOrQueue)
        {
            var frame = Frame.createNew(Commands.SEND);
            frame.appendHeader(Headers.DESTINATION, topicOrQueue);
            return frame;
        };

    /// Specify the data and functions exported from the module.
    exports.Commands         = Commands;
    exports.Headers          = Headers;
    exports.ParserState      = ParseStates;
    exports.Frame            = Frame;
    exports.Parser           = Parser;
    exports.ClientConnection = ClientConnection;
    exports.ClientConnector  = ClientConnector;
    return exports;
}(STOMP || {}));
