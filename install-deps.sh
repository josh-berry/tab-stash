#!/bin/sh

set -ex

NODE_VERSION=20

deps_apt() {
    # Check for old Ubuntus
    if [ "$(lsb_release -i |awk '{print $3}')" = "Ubuntu" ]; then
        if [ "$(lsb_release -r |awk '{print $2}' |cut -d. -f1)" -lt 22 ]; then
            die "Sorry, your Ubuntu is too old.  Please use 22.04 or newer."
        fi
    fi

    # Make sure we have the latest packages
    sudo apt-get update

    # Inkscape
    if type snap; then
        if snap list inkscape 2>/dev/null; then
            # The snap version of inkscape messes up the path of passed-in
            # arguments, so doing normal things like running inkscape on a file
            # using a relative path just doesn't work...
            die "Inkscape is known to be broken when installed via snap." \
                "Please install it with apt-get instead."
        fi
    fi
    if ! type inkscape; then
        if type add-apt-repository; then
            sudo add-apt-repository universe
            sudo apt-get update
        fi
        sudo apt-get install -y inkscape
    fi

    # Build tools
    sudo apt-get install -y make git diffutils patch rsync zip ca-certificates curl gnupg

    if ! type node; then
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_VERSION.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

        sudo apt-get update
        sudo apt-get install -y nodejs

    elif [ "$(node --version |cut -c2-3)" -lt $NODE_VERSION ]; then
        die "Please upgrade Node.js to v$NODE_VERSION or later (you have $(node --version))."
    fi
}

deps_brew() {
    # We need Homebrew (which should install developer tools)
    if ! type brew; then
        die "Please install Homebrew first, which you can do by running:" \
             "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    fi

    type inkscape || brew install --cask inkscape
    type node || brew install node
    type npm || brew install npm
}

die() {
    set +ex
    echo "" >&2
    while [ $# -gt 0 ]; do
        echo "!!! $1" >&2
        shift
    done
    echo "" >&2
    exit 1
}

if type apt-get; then
    deps_apt

elif type pkgutil && [ "$(uname)" = "Darwin" ]; then
    deps_brew

else
    die "Don't know how to check/install dependencies on this platform."
fi

set +ex
echo
echo ">>> All done!  You're ready to build Tab Stash."
echo
