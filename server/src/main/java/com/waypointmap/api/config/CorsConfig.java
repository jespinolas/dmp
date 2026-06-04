package com.waypointmap.api.config;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins("http://localhost:3001", "http://localhost:8081")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }

    // P6: Security response headers for all API responses
    @Bean
    public Filter securityHeadersFilter() {
        return (ServletRequest request, ServletResponse response, FilterChain chain) -> {
            HttpServletResponse httpResp = (HttpServletResponse) response;
            httpResp.setHeader("X-Content-Type-Options", "nosniff");
            httpResp.setHeader("Cache-Control", "no-store");
            chain.doFilter(request, response);
        };
    }
}
