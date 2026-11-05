plugins { java }

repositories {
    maven { url = uri("$rootDir/repo") }
}

dependencies {
    implementation(libs.lib)
}
