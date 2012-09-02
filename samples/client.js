/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements a simple STOMP over WebSocket test client.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var connector        = null;
var outputText       = null;
var connectButton    = null;
var disconnectButton = null;

function connectClick()
{
    connector.url      = document.getElementById('url').value;
    connector.host     = document.getElementById('hostname').value;
    connector.username = document.getElementById('username').value;
    connector.password = document.getElementById('password').value;
    connector.connect();
}

function disconnectClick()
{
    outputText.value += 'Starting disconnect...\n';
    connector.disconnect(true);
}

function errorHandler(conn, error)
{
    outputText.value += 'An error occurred:\n';
    outputText.value += error+'\n';
}

function readyHandler(conn)
{
    outputText.value += 'The connector is ready.\n';
}

function subscribeHandler(conn)
{
    outputText.value += 'Subscribing to topics.\n';
    var frame = conn.createSubscribe(0, '/topic/debug');
    conn.send(frame);
}

function rejectedHandler(conn)
{
    outputText.value += 'The server rejected the supplied credentials.\n'
}

function disconnectHandler(conn)
{
    outputText.value += 'Disconnected.\n';
}

function messageHandler(conn, frame)
{
    outputText.value += 'Received frame '+frame.command+'\n';
}

function contentReady()
{
    document.removeEventListener('DOMContentLoaded', contentReady);
    connector                = new STOMP.ClientConnector();
    outputText               = document.getElementById('output_text');
    connectButton            = document.getElementById('connect');
    disconnectButton         = document.getElementById('disconnect');
    connectButton.onclick    = connectClick;
    disconnectButton.onclick = disconnectClick;
    connector.on('error',      errorHandler);
    connector.on('ready',      readyHandler);
    connector.on('message',    messageHandler);
    connector.on('rejected',   rejectedHandler);
    connector.on('subscribe',  subscribeHandler);
    connector.on('disconnect', disconnectHandler);
}

// run as soon as the DOM is ready.
document.addEventListener('DOMContentLoaded', contentReady);
